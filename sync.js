// 여러 컴퓨터 동기화 — 메인 프로세스 쪽. Firebase(Firestore)와 주고받는 일을 전담한다.
//
// 화면(renderer)은 자료를 고치고 save()만 하면 되고, 여기서 바뀐 레코드를 골라 올린다.
// 반대로 다른 컴퓨터에서 바뀐 것이 내려오면 합쳐서 화면에 "이걸로 바꿔라"고 보낸다.
//
// 연결 상태는 sync.json 에 따로 보관한다 — data.json 은 맥판과 형식을 맞춰야 하므로 건드리지 않는다.

const fs = require("fs");
const path = require("path");
const M = require("./syncmodel");

// Firebase 프로젝트 설정 — 웹에 공개되는 값이라 그대로 담아도 된다(비밀키가 아니다).
// 실제 접근 차단은 Firestore 보안 규칙(로그인한 사용자만 허용)으로 한다.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCtz7nuQWf9fNgrI_Bwy1On_mffnip3Lfo",
  authDomain: "rentdesk-47f0c.firebaseapp.com",
  projectId: "rentdesk-47f0c",
  storageBucket: "rentdesk-47f0c.firebasestorage.app",
  messagingSenderId: "238522467962",
  appId: "1:238522467962:web:0f58061ef8894e88f99dc3",
};

// 헷갈리는 글자(0/O, 1/I 등)를 뺀 글자판. 20자리 — 코드를 아는 사람만 들어오므로 길게 잡는다.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 20;

class Sync {
  /// dataDir: 자료 폴더, onRemote: 내려온 자료를 화면에 전달할 함수, onStatus: 상태 알림
  constructor({ dataDir, onRemote, onStatus }) {
    this.metaPath = path.join(dataDir, "sync.json");
    this.onRemote = onRemote;
    this.onStatus = onStatus;
    this.meta = this.readMeta();       // { code, mode: "edit"|"view", shadow }
    this.fb = null;                    // Firebase 연결 묶음 (연결했을 때만 만든다)
    this.unsubs = [];
    this.lastError = null;
    this.connected = false;
    this.pushing = false;
    this.pendingData = null;
  }

  // ===== 상태 보관 =====

  readMeta() {
    try { return JSON.parse(fs.readFileSync(this.metaPath, "utf8")); } catch { return null; }
  }
  writeMeta() {
    try {
      if (this.meta) fs.writeFileSync(this.metaPath, JSON.stringify(this.meta));
      else fs.rmSync(this.metaPath, { force: true });
    } catch (e) { this.lastError = "연결 정보 저장 실패: " + e.message; }
  }

  status() {
    return {
      enabled: !!(this.meta && this.meta.code),
      code: this.meta ? this.meta.code : null,
      mode: this.meta ? this.meta.mode : null,
      readOnly: !!(this.meta && this.meta.mode === "view"),
      connected: this.connected,
      error: this.lastError,
    };
  }
  notify() { if (this.onStatus) this.onStatus(this.status()); }

  // ===== 연결 =====

  static makeCode() {
    const { randomInt } = require("crypto");
    let s = "";
    for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
    // 넷씩 끊어 읽기 쉽게 — 넣을 때는 하이픈을 무시한다
    return s.match(/.{1,4}/g).join("-");
  }
  static cleanCode(code) {
    return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  /// 이 컴퓨터를 기준으로 새 연결을 만든다(내 자료가 올라간다).
  async createSpace(localData) {
    const code = Sync.makeCode();
    this.meta = { code, mode: "edit", shadow: null };
    this.writeMeta();
    await this.start(localData);
    return this.status();
  }

  /// 다른 컴퓨터가 만든 코드로 들어간다. mode: "edit" 또는 "view"(열람 전용)
  async joinSpace(code, mode, localData) {
    const clean = Sync.cleanCode(code);
    if (clean.length < 8) throw new Error("연결 코드가 올바르지 않습니다.");
    this.meta = { code: clean.match(/.{1,4}/g).join("-"), mode: mode === "view" ? "view" : "edit", shadow: null };
    this.writeMeta();
    // 들어가는 쪽은 내 자료를 올리지 않는다 — 먼저 받고, 받은 것으로 맞춘다.
    await this.start(localData, { pushLocal: false });
    return this.status();
  }

  unpair() {
    this.stop();
    this.meta = null;
    this.writeMeta();
    this.notify();
  }

  /// 열람 전용 ↔ 수정 가능 전환 (그 컴퓨터에서만 바꾼다)
  setMode(mode) {
    if (!this.meta) return this.status();
    this.meta.mode = mode === "view" ? "view" : "edit";
    this.writeMeta();
    this.notify();
    return this.status();
  }

  // ===== Firebase 연결 =====

  async ensureFirebase() {
    if (this.fb) return this.fb;
    const { initializeApp } = require("firebase/app");
    const { getAuth, signInAnonymously } = require("firebase/auth");
    const fsMod = require("firebase/firestore");
    const app = initializeApp(FIREBASE_CONFIG);
    const db = fsMod.getFirestore(app);
    try {
      await signInAnonymously(getAuth(app));
    } catch (e) {
      // 익명 로그인이 꺼져 있어도 규칙이 허용하면 동작한다 — 막히면 아래 수신/쓰기에서 오류가 난다.
      this.lastError = "로그인 실패: " + (e.code || e.message);
    }
    this.fb = { app, db, fsMod };
    return this.fb;
  }

  /// 연결 시작 — 저장된 코드가 있으면 앱 시작 시 자동으로 불린다.
  async start(localData, { pushLocal = true } = {}) {
    if (!this.meta || !this.meta.code) return;
    this.stopListeners();
    const { db, fsMod } = await this.ensureFirebase();
    const code = this.meta.code;

    // 내 자료를 먼저 올린다(새로 만든 연결일 때만). 이미 맞춰둔 사본이 있으면 바뀐 것만 올라간다.
    if (pushLocal && this.meta.mode === "edit" && localData) await this.push(localData);

    // 자료는 종류별(건물/호실/입금내역/…)로 따로 도착한다. 처음 받는 동안에는 반쪽짜리
    // (건물은 있는데 호실은 없는) 상태가 되므로, 전 종류가 한 번씩 도착할 때까지 반영을 미룬다.
    // 그래야 그 순간 앱이 꺼져도 자료가 반쪽만 남지 않는다.
    this.awaiting = new Set(M.COLS);
    this.firstBatch = [];
    clearTimeout(this.firstTimer);
    this.firstTimer = setTimeout(() => this.flushFirstBatch(), 8000);  // 일부가 안 와도 8초 뒤엔 반영

    // 컬렉션별 실시간 수신
    for (const col of M.COLS) {
      const ref = fsMod.collection(db, "spaces", code, col);
      const unsub = fsMod.onSnapshot(ref, (snap) => {
        const recs = snap.docs.map((d) => ({ col, id: d.id, doc: d.data() }));
        this.connected = true;
        this.lastError = null;
        if (this.awaiting) {
          this.firstBatch.push(...recs);
          this.awaiting.delete(col);
          if (this.awaiting.size === 0) this.flushFirstBatch();
        } else {
          this.applyRemote(recs);
        }
        this.notify();
      }, (err) => {
        this.connected = false;
        this.lastError = this.explain(err);
        this.notify();
      });
      this.unsubs.push(unsub);
    }
    this.notify();
  }

  explain(err) {
    const code = err && (err.code || err.message) || "";
    if (String(code).includes("permission-denied")) {
      return "접근이 거부됐습니다. Firebase 콘솔에서 익명 로그인 사용 설정과 보안 규칙을 확인하세요.";
    }
    if (String(code).includes("unavailable")) return "인터넷에 연결되지 않아 잠시 멈췄습니다. 연결되면 자동으로 다시 맞춥니다.";
    return "동기화 오류: " + code;
  }

  /// 처음 받은 자료를 한꺼번에 반영한다(반쪽 상태로 저장되지 않게).
  flushFirstBatch() {
    clearTimeout(this.firstTimer);
    const recs = this.firstBatch || [];
    this.awaiting = null;
    this.firstBatch = [];
    if (recs.length) this.applyRemote(recs);
  }

  stopListeners() {
    for (const u of this.unsubs) { try { u(); } catch {} }
    this.unsubs = [];
    clearTimeout(this.firstTimer);
    this.awaiting = null;
    this.firstBatch = [];
  }
  stop() {
    this.stopListeners();
    this.connected = false;
  }

  // ===== 올리기 =====

  /// 화면에서 자료가 바뀔 때마다 불린다. 바뀐 레코드만 올린다.
  async push(data) {
    if (!this.meta || !this.meta.code) return;
    if (this.meta.mode === "view") return;           // 열람 전용은 올리지 않는다
    if (this.pushing) { this.pendingData = data; return; }   // 올리는 중이면 마지막 것만 남겨 뒤에 처리
    this.pushing = true;
    try {
      const { db, fsMod } = await this.ensureFirebase();
      const flat = M.flatten(data);
      const changes = M.changes(this.meta.shadow, flat, Date.now());
      if (changes.length) {
        // 한 번에 여러 건은 batch 로 — 500건이 한 묶음 한계라 쪼갠다.
        for (let i = 0; i < changes.length; i += 400) {
          const batch = fsMod.writeBatch(db);
          for (const { col, id, doc } of changes.slice(i, i + 400)) {
            batch.set(fsMod.doc(db, "spaces", this.meta.code, col, id), doc);
          }
          await batch.commit();
        }
        // 올린 것을 '맞춰둔 사본'에 반영 — 다음에 또 올리지 않도록
        this.meta.shadow = M.mergeRemote(this.meta.shadow, changes);
        this.writeMeta();
      }
      this.connected = true;
      this.lastError = null;
    } catch (e) {
      this.connected = false;
      this.lastError = this.explain(e);
    } finally {
      this.pushing = false;
      this.notify();
      const next = this.pendingData;
      if (next) { this.pendingData = null; this.push(next); }
    }
  }

  // ===== 내려온 것 반영 =====

  applyRemote(records) {
    if (!this.meta) return;
    const before = this.meta.shadow;
    const merged = M.mergeRemote(before, records);
    // 내용이 그대로면 화면을 건드리지 않는다(내가 올린 것이 되돌아온 경우가 대부분이다)
    if (JSON.stringify(merged) === JSON.stringify(before)) return;
    this.meta.shadow = merged;
    this.writeMeta();
    if (this.onRemote) this.onRemote(M.rebuild(merged));
  }
}

module.exports = { Sync, FIREBASE_CONFIG };
