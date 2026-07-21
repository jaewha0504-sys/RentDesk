"use strict";

// ===== 상태 =====
let data = { buildings: [], moveOuts: [], taxIssued: [] };
let selBuildingId = null, selUnitId = null;
let selPayments = new Set(), anchorPayment = null;
let saveTimer = null;

const OCC = "임대중", VAC = "공실", MRG = "통합됨", SAME = "짝/홀수달 동일", DIFF = "짝/홀수달 상이";

// ===== 통임대 (여러 호실을 한 임차인이 사용) =====
function mergedChildren(b, hostId) { return b.units.filter((x) => x.status === MRG && x.mergedInto === hostId); }
function unitName(u) { return [u.floor, u.unit].filter(Boolean).join(" ") || "(호실)"; }
function findUnitById(b, id) { return b.units.find((x) => x.id === id) || null; }
function mergeUnit(b, childId, hostId) {
  const child = findUnitById(b, childId), host = findUnitById(b, hostId);
  if (!child || !host || child.id === host.id) return;
  releaseMergedChildren(b, child.id);          // 대표였던 호실이면 자식 먼저 해제
  Object.assign(child, { status: MRG, mergedInto: host.id, tenant: "", owner: null, phone: null, bizNo: null, bank: "", taxDay: 0, startDate: null, endDate: null, deposit: 0, rent: 0, maintenance: 0, commonOdd: null, commonEven: null, payments: [] });
}
function unmergeUnit(b, id) { const u = findUnitById(b, id); if (u) { u.status = VAC; u.mergedInto = null; } }
function releaseMergedChildren(b, hostId) { mergedChildren(b, hostId).forEach((c) => { c.status = VAC; c.mergedInto = null; }); }

// ===== 유틸 =====
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
const won = (n) => (Number(n) || 0).toLocaleString("en-US");
const wonStr = (n) => won(n) + " 원";
const withVAT = (n) => Math.round((Number(n) || 0) * 1.1);
const parseNum = (s) => { const d = String(s).replace(/[^0-9]/g, ""); return d ? parseInt(d, 10) : 0; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function pad2(n) { return String(n).padStart(2, "0"); }
function ymdOf(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; // 현지시간 기준
}
function isoOf(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toISOString(); // 현지 자정을 인스턴트로 (Swift와 호환)
}
function todayYmd() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function nowMonthKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function monthKeyOf(ymd) { return ymd ? ymd.slice(0, 7) : ""; }
function startOfMonthYmd(ymd) { return ymd.slice(0, 7) + "-01"; }
function nextMonth(period) {
  const [y, m] = period.split("-").map(Number);
  let yy = y, mm = m + 1; if (mm === 13) { yy++; mm = 1; }
  return `${yy}-${String(mm).padStart(2, "0")}`;
}
function monthsBetween(startYmd, endYmd) {
  const out = []; if (!startYmd || !endYmd) return out;
  let [y, m] = startYmd.slice(0, 7).split("-").map(Number);
  const [ey, em] = endYmd.slice(0, 7).split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m === 13) { y++; m = 1; }
  }
  return out;
}
function recentMonths(n) {
  const out = []; const d = new Date();
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`); }
  return out;
}

// 공용요금(공동수도·공동전기) — 홀/짝수달 금액이 다를 때 사용
const hasCommon = (u) => (u.commonOdd || 0) > 0 || (u.commonEven || 0) > 0;
function commonFor(u, period) {
  const mm = parseInt(String(period).split("-")[1], 10) || 1;
  return mm % 2 === 0 ? (u.commonEven || 0) : (u.commonOdd || 0);
}
// 그 달의 관리비 + 공용요금
function maintFor(u, period) { return (u.maintenance || 0) + commonFor(u, period); }

/// 부가세액만 (합계 - 공급가액)
const vatOnly = (v) => withVAT(v) - (Number(v) || 0);

/// 휴대폰 자동 하이픈 (3-4-4)
function formatPhone(s) {
  const d = String(s).replace(/[^0-9]/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}
/// 사업자등록번호 자동 하이픈 (3-2-5)
function formatBizNo(s) {
  const d = String(s).replace(/[^0-9]/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/// 구버전 "관리비 짝/홀수달 상이" → "관리비(동일) + 공용요금(홀/짝)" 구조로 이전
function migrateCommonFee(d) {
  let changed = false;
  for (const b of d.buildings || []) {
    for (const u of b.units || []) {
      if (u.maintMode !== DIFF || u.commonOdd != null || u.commonEven != null) continue;
      const base = Math.min(u.maintenance || 0, u.maintEven || 0);
      u.commonOdd = (u.maintenance || 0) - base;
      u.commonEven = (u.maintEven || 0) - base;
      u.maintenance = base;
      u.maintEven = 0;
      u.maintMode = SAME;
      changed = true;
    }
  }
  return changed;
}
const expectedFor = (u, p) => (u.rent || 0) + maintFor(u, p);
const expectedVAT = (u, p) => withVAT(expectedFor(u, p));
// 미납 합계 — 이번 달은 세금계산서 발행일 전까지 미납으로 치지 않고, 미래 달도 제외
const unpaidTotal = (u) => {
  const cur = nowMonthKey(), today = new Date().getDate();
  return (u.payments || []).reduce((s, p) => {
    if (!p.isOpening) {
      if (p.period > cur) return s;                                        // 미래 달
      if (p.period === cur && (u.taxDay || 0) > 0 && today < u.taxDay) return s; // 발행일 전
    }
    return s + (p.due || 0) - (p.paid || 0);
  }, 0);
};

const building = () => data.buildings.find((b) => b.id === selBuildingId) || null;
const unit = () => { const b = building(); return b ? (b.units.find((x) => x.id === selUnitId) || null) : null; };
function findUnit(id) { for (const b of data.buildings) { const u = b.units.find((x) => x.id === id); if (u) return u; } return null; }

// ===== 저장/로드 =====
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => window.api.save(JSON.stringify(data, null, 2)), 300); }
async function load() {
  const raw = await window.api.load();
  if (raw) { try { data = JSON.parse(raw); } catch { data = { buildings: [], moveOuts: [], taxIssued: [] }; } }
  data.buildings ||= []; data.moveOuts ||= []; data.taxIssued ||= [];
  if (migrateCommonFee(data)) save();   // 구조 바뀌었으면 즉시 저장
  if (data.buildings.length === 0) seed();
  selBuildingId = data.buildings[0]?.id || null;
  selUnitId = building()?.units[0]?.id || null;
}

function seed() {
  const months = recentMonths(3);
  const pays = (rent, maint, unpaidN) => {
    const base = withVAT(rent + maint);
    return months.map((m, i) => { const unpaid = i >= months.length - unpaidN; return { id: uid(), period: m, due: base, paid: unpaid ? 0 : base, paidDate: unpaid ? null : isoOf(m + "-05"), memo: "" }; });
  };
  const U = (o) => Object.assign({ id: uid(), floor: "", unit: "", status: OCC, mergedInto: null, tenant: "", owner: null, phone: null, bizNo: null, taxDay: 0, bank: "", startDate: null, endDate: null, deposit: 0, rent: 0, maintMode: SAME, maintenance: 0, maintEven: 0, memo: "", businessCert: null, contract: null, payments: [] }, o);
  data.buildings = [
    { id: uid(), name: "강남 본사빌딩", address: "서울시 강남구", memo: "", units: [
      U({ floor: "3층", unit: "301호", tenant: "(주)미래상사", taxDay: 1, bank: "국민은행", startDate: isoOf("2024-03-01"), endDate: isoOf("2026-02-28"), deposit: 50000000, rent: 3000000, maintenance: 400000, payments: pays(3000000, 400000, 0) }),
      U({ floor: "3층", unit: "302호", status: VAC, rent: 2800000, maintenance: 350000, memo: "임대 문의 중" }),
      U({ floor: "4층", unit: "401호", tenant: "디자인스튜디오", taxDay: 1, bank: "신한은행", startDate: isoOf("2025-01-01"), endDate: isoOf("2026-08-31"), deposit: 40000000, rent: 3200000, maintMode: DIFF, maintenance: 400000, maintEven: 300000, payments: pays(3200000, 400000, 0) }),
    ]},
    { id: uid(), name: "역삼 상가", address: "서울시 강남구 역삼동", memo: "", units: [
      U({ floor: "1층", unit: "", tenant: "행복카페", taxDay: 5, bank: "우리은행", startDate: isoOf("2023-07-01"), endDate: isoOf("2026-06-30"), deposit: 30000000, rent: 2500000, maintenance: 200000, memo: "2개월 월세 미납", payments: pays(2500000, 200000, 2) }),
      U({ floor: "2층", unit: "", status: VAC, rent: 2000000, maintenance: 150000 }),
    ]},
  ];
}

// ===== 렌더 =====
function renderAll() { renderBuildings(); renderUnits(); renderTax(); renderDetail(); }

function floorKey(f) { const neg = (f || "").includes("지하"); const n = parseInt((f || "").replace(/[^0-9]/g, ""), 10) || 0; return neg ? -n : n; }

function renderBuildings() {
  const ul = document.getElementById("buildingList"); ul.innerHTML = "";
  data.buildings.forEach((b, idx) => {
    const vac = b.units.filter((u) => u.status === VAC).length;
    const od = b.units.filter((u) => unpaidTotal(u) > 0).length;
    const li = document.createElement("li");
    li.className = "row" + (b.id === selBuildingId ? " sel" : "");
    li.draggable = true; li.dataset.idx = idx;
    li.innerHTML = `<div class="name">${esc(b.name)}</div><div class="sub">${b.units.length}호${vac ? " · 공실 " + vac : ""}${od ? ' · <span class="unpaid">미납 ' + od + "</span>" : ""}</div>`;
    li.onclick = () => { selBuildingId = b.id; selUnitId = b.units[0]?.id || null; selPayments.clear(); renderAll(); };
    li.ondblclick = () => openBuildingEditor(b);
    li.ondragstart = (e) => e.dataTransfer.setData("text/plain", String(idx));
    li.ondragover = (e) => e.preventDefault();
    li.ondrop = (e) => { e.preventDefault(); const from = +e.dataTransfer.getData("text/plain"); const to = idx; const [m] = data.buildings.splice(from, 1); data.buildings.splice(to, 0, m); save(); renderBuildings(); };
    ul.appendChild(li);
  });
}

function renderUnits() {
  const b = building();
  document.getElementById("unitTitle").textContent = b ? b.name : "호실 목록";
  const ul = document.getElementById("unitList"); ul.innerHTML = "";
  const sum = document.getElementById("unitSummary");
  if (!b) { sum.textContent = ""; return; }
  const units = [...b.units].sort((a, c) => floorKey(a.floor) - floorKey(c.floor) || (a.unit || "").localeCompare(c.unit || ""));
  units.forEach((u) => {
    const up = unpaidTotal(u);
    const li = document.createElement("li");
    li.className = "row" + (u.status === VAC ? " vac" : "") + (u.id === selUnitId ? " sel" : "");
    const nm = unitName(u);
    let right = u.status === VAC ? '<span class="badge">공실</span>'
      : u.status === MRG ? '<span class="badge">통임대</span>'
      : (up > 0 ? `<span class="unpaid">미납 ${won(up)}</span>` : "");
    let sub;
    if (u.status === MRG) {
      const host = u.mergedInto ? findUnitById(b, u.mergedInto) : null;
      sub = host ? `${unitName(host)}에 포함` : "통임대 (대표 호실 없음)";
    } else if (u.status === VAC) {
      sub = "공실";
    } else {
      const kids = mergedChildren(b, u.id);
      sub = (u.tenant || "임차인 미입력") + (kids.length ? ` · ${kids.map(unitName).join(", ")} 포함` : "");
    }
    li.innerHTML = `<span class="right">${right}</span><div class="name">${esc(nm)}</div><div class="sub">${esc(sub)}</div>`;
    li.onclick = () => { selUnitId = u.id; selPayments.clear(); renderDetail(); markUnitSel(); };
    ul.appendChild(li);
  });
  const total = b.units.length, vac = b.units.filter((u) => u.status === VAC).length;
  const income = b.units.filter((u) => u.status === OCC).reduce((s, u) => s + expectedFor(u, nowMonthKey()), 0);
  const odTotal = b.units.reduce((s, u) => s + Math.max(unpaidTotal(u), 0), 0);
  sum.textContent = `호실 ${total} · 공실 ${vac} · 월수입 ${won(income)}원 · 미납 ${won(odTotal)}원`;
}
function markUnitSel() { document.querySelectorAll("#unitList .row").forEach((el) => el.classList.remove("sel")); }

// ----- 상세 -----
function vatPair(v) { return `${won(v)} 원 (부가세 포함 ${won(withVAT(v))} 원)`; }
function maintText(u) { return vatPair(u.maintenance || 0); }
function commonText(u) { return `홀수달 ${vatPair(u.commonOdd || 0)}\n짝수달 ${vatPair(u.commonEven || 0)}`; }
function expectedText(u) {
  const r = u.rent || 0, m = u.maintenance || 0;
  if (hasCommon(u)) return `홀수달 ${vatPair(r + m + (u.commonOdd || 0))}\n짝수달 ${vatPair(r + m + (u.commonEven || 0))}`;
  return vatPair(r + m);
}
function periodText(u) {
  if (!u.startDate && !u.endDate) return "—";
  let s = `${ymdOf(u.startDate) || "?"} ~ ${ymdOf(u.endDate) || "?"}`;
  if (u.endDate) { const days = Math.ceil((new Date(ymdOf(u.endDate)) - new Date(todayYmd())) / 86400000); if (days < 0) s += "  (만료)"; else if (days <= 60) s += `  (D-${days})`; }
  return s;
}

function renderDetail() {
  const host = document.getElementById("detailBody");
  const b = building(), u = unit();
  if (!u) { host.innerHTML = `<div class="vacant-note">호실을 선택하세요</div>`; return; }
  const head = `<div class="det-head">
      <div><div class="bn">${esc(b.name)}</div><div class="rn">${esc(unitName(u))}${mergedChildren(b, u.id).map((c) => ` <span class="muted">+ ${esc(c.unit || unitName(c))}</span>`).join("")}</div></div>
      <span class="statusbadge ${u.status === VAC ? "vac" : "occ"}">${u.status === MRG ? "통임대" : u.status}</span>
      <span class="sp"></span>
      <button id="btnBiz">${u.businessCert ? "✓ 사업자등록증" : "📎 사업자등록증"}</button>
      <button id="btnContract">${u.contract ? "✓ 계약서" : "📎 계약서"}</button>
      <button id="btnEditUnit" class="accent">정보 수정</button>
    </div>`;
  if (u.status === MRG) {
    const h = u.mergedInto ? findUnitById(b, u.mergedInto) : null;
    host.innerHTML = head + `<div class="vacant-note">이 호실은 ${esc(h ? unitName(h) : "다른 호실")}에 포함된 통임대 호실입니다.<br>계약·입금내역은 대표 호실에서 관리합니다.
      ${h ? `<br><br><button id="btnGotoHost">대표 호실(${esc(unitName(h))}) 보기</button>` : ""}</div>`;
    const gh = document.getElementById("btnGotoHost");
    if (gh) gh.onclick = () => { selUnitId = h.id; selPayments.clear(); renderAll(); };
  } else if (u.status === VAC) {
    host.innerHTML = head + `<div class="vacant-note">이 호실은 현재 공실입니다.<br>‘정보 수정’에서 임대중으로 바꾸면 정보·입금내역이 표시됩니다.</div>`;
  } else {
    const row = (lab, val) => `<div class="inforow"><span class="lab">${lab}</span><span class="val">${val}</span></div>`;
    // 왼쪽: 임차인·대표자·연락처·입금은행·발행일·계약기간 / 오른쪽: 사업자등록번호·보증금·월세·관리비(·공용요금)·총액
    const left = [
      row("임차인", esc(u.tenant || "—")),
      row("대표자", esc(u.owner || "—")),
      row("연락처", esc(u.phone || "—")),
      row("입금은행", esc(u.bank || "—")),
      row("세금계산서 발행일", u.taxDay > 0 ? "매달 " + u.taxDay + "일" : "—"),
      row("계약기간", periodText(u)),
    ];
    const right = [
      row("사업자등록번호", esc(u.bizNo || "—")),
      row("보증금", wonStr(u.deposit)),
      row("월세", vatPair(u.rent)),
      row("관리비", maintText(u)),
      ...(hasCommon(u) ? [row("공용요금", commonText(u))] : []),
      row("총 입금예정금액", expectedText(u)),
    ];
    const info = `<div class="infocard">
      <div class="infocol">${left.join("")}</div>
      <div class="infocol">${right.join("")}</div>
    </div>`;
    host.innerHTML = head + info + ledgerHTML(u);
    wireLedger(u);
  }
  document.getElementById("btnEditUnit").onclick = () => openUnitEditor(u);
  document.getElementById("btnBiz").onclick = () => attachAction(u, "biz", "businessCert", "사업자등록증");
  document.getElementById("btnContract").onclick = () => attachAction(u, "contract", "contract", "계약서");
  // 행 밖 클릭 시 선택 해제
  host.onclick = (e) => {
    if (e.target.closest("tbody tr[data-id]") || e.target.closest("button, input, select")) return;
    if (selPayments.size) { selPayments.clear(); anchorPayment = null; renderDetail(); }
  };
}

function unpaidParts(v) {
  return { txt: v > 0 ? "-" + won(v) : (v < 0 ? "+" + won(-v) : "—"), cls: v > 0 ? "red" : (v < 0 ? "green" : "") };
}

function ledgerHTML(u) {
  let cum = 0;
  const rows = (u.payments || []).map((p) => {
    const tu = (p.due || 0) - (p.paid || 0); cum += tu;
    const tp = unpaidParts(tu), cp = unpaidParts(cum);
    const cls = (selPayments.has(p.id) ? "sel " : "") + (p.isOpening ? "opening" : "");
    if (p.isOpening) {
      return `<tr data-id="${p.id}" class="${cls}">
        <td style="color:var(--accent)">과거 누적</td>
        <td colspan="3"></td>
        <td class="num c-this ${tp.cls}">${tp.txt}</td>
        <td class="num c-cum ${cp.cls}">${cp.txt}</td>
        <td><div style="display:flex;align-items:center;gap:6px;justify-content:center"><span class="muted">과거 미납액</span><input class="num d-open" inputmode="numeric" style="width:110px" value="${p.due ? won(p.due) : ""}"></div></td>
      </tr>`;
    }
    return `<tr data-id="${p.id}" class="${cls}">
      <td class="dragcell" title="드래그해서 행 순서 이동">${esc(p.period)}</td>
      <td><input class="num d-due" inputmode="numeric" value="${p.due ? won(p.due) : ""}"></td>
      <td><input class="num d-paid" inputmode="numeric" value="${p.paid ? won(p.paid) : ""}"></td>
      <td><input type="date" class="d-date" value="${ymdOf(p.paidDate)}"></td>
      <td class="num c-this ${tp.cls}">${tp.txt}</td>
      <td class="num c-cum ${cp.cls}">${cp.txt}</td>
      <td><input class="d-memo" value="${esc(p.memo || "")}"></td>
    </tr>`;
  }).join("");
  return `<div class="ledger-head"><h2>월별 입금내역</h2><span class="muted">셀을 클릭해 바로 수정 · Ctrl/Shift로 복수선택</span><span class="sp"></span>
      <button id="btnFill">빠진 달 채우기</button>
      <button id="btnDelPay" class="danger">행 삭제</button>
      <button id="btnAddPay" class="accent">+ 입금내역 추가</button></div>
    <table class="ledger"><thead><tr>
      <th>입금월</th><th>입금예정액</th><th>실입금액</th><th>실입금일</th><th>당월미납</th><th>누적미납</th><th>메모</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

// 표 전체를 다시 그리지 않고 미납 계산값만 갱신 (입력칸 유지 → 클릭/편집 안정)
function refreshComputed(u) {
  let cum = 0;
  document.querySelectorAll("#detailBody tbody tr[data-id]").forEach((tr) => {
    const p = u.payments.find((x) => x.id === tr.dataset.id); if (!p) return;
    const tu = (p.due || 0) - (p.paid || 0); cum += tu;
    const tp = unpaidParts(tu), cp = unpaidParts(cum);
    const c1 = tr.querySelector(".c-this"), c2 = tr.querySelector(".c-cum");
    if (c1) { c1.textContent = tp.txt; c1.className = "num c-this " + tp.cls; }
    if (c2) { c2.textContent = cp.txt; c2.className = "num c-cum " + cp.cls; }
  });
  renderBuildings(); renderUnits();
}

function wireLedger(u) {
  document.getElementById("btnAddPay").onclick = () => { addPaymentSmart(u); save(); renderDetail(); };
  document.getElementById("btnFill").onclick = () => { fillMissing(u); save(); renderDetail(); };
  document.getElementById("btnDelPay").onclick = () => {
    if (!selPayments.size) return alert("삭제할 행을 선택하세요.");
    u.payments = u.payments.filter((p) => !selPayments.has(p.id)); selPayments.clear(); save(); renderDetail();
  };
  document.querySelectorAll("#detailBody tbody tr[data-id]").forEach((tr) => {
    const id = tr.dataset.id; const p = u.payments.find((x) => x.id === id); if (!p) return;
    const dueIn = tr.querySelector(".d-due"), openIn = tr.querySelector(".d-open"), paidIn = tr.querySelector(".d-paid");
    if (dueIn) { bindMoney(dueIn); dueIn.onchange = () => { p.due = parseNum(dueIn.value); refreshComputed(u); save(); }; }
    if (openIn) { bindMoney(openIn); openIn.onchange = () => { p.due = parseNum(openIn.value); refreshComputed(u); save(); }; }
    if (paidIn) { bindMoney(paidIn); paidIn.onchange = () => {
        p.paid = parseNum(paidIn.value);
        if (p.paid > 0 && !p.paidDate) { p.paidDate = isoOf(todayYmd()); const di = tr.querySelector(".d-date"); if (di) di.value = ymdOf(p.paidDate); }
        refreshComputed(u); save();
      }; }
    const dateIn = tr.querySelector(".d-date");
    if (dateIn) dateIn.onchange = () => { p.paidDate = dateIn.value ? isoOf(dateIn.value) : null; save(); };
    const memoIn = tr.querySelector(".d-memo");
    if (memoIn) memoIn.onchange = () => { p.memo = memoIn.value; save(); };
    // 드래그로 행 순서 이동 (입금월 칸이 손잡이) — 행 전체가 따라오고 다른 행은 밀려남
    const dragCell = tr.querySelector(".dragcell");
    if (dragCell) dragCell.onmousedown = (e) => startRowDrag(e, tr, u);
    tr.onclick = (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.shiftKey && anchorPayment) {
        const ids = u.payments.map((x) => x.id); const a = ids.indexOf(anchorPayment), bb = ids.indexOf(id);
        selPayments = new Set(ids.slice(Math.min(a, bb), Math.max(a, bb) + 1));
      } else if (e.metaKey || e.ctrlKey) {
        selPayments.has(id) ? selPayments.delete(id) : selPayments.add(id); anchorPayment = id;
      } else { selPayments = new Set([id]); anchorPayment = id; }
      renderDetail();
    };
  });
}

// 행 드래그 정렬 — 잡은 행이 마우스를 따라오고, 지나치는 행은 위/아래로 밀려나는 애니메이션
function startRowDrag(e, tr, u) {
  if (e.button !== 0) return;
  const tbody = tr.parentElement;
  const rows = [...tbody.querySelectorAll("tr[data-id]")];
  const startIndex = rows.indexOf(tr);
  const minIndex = u.payments.length && u.payments[0].isOpening ? 1 : 0; // 과거누적 행 위로는 못 감
  const maxIndex = rows.length - 1;
  if (startIndex < minIndex || maxIndex === minIndex) return; // 움직일 자리가 없으면 무시
  e.preventDefault();
  const rowH = tr.offsetHeight;
  const startY = e.clientY;
  let curIndex = startIndex;
  let moved = false;   // 3px 이상 움직여야 드래그로 간주 — 그냥 클릭이면 행 선택이 정상 동작

  const onMove = (ev) => {
    let dy = ev.clientY - startY;
    if (!moved) {
      if (Math.abs(dy) < 3) return;
      moved = true;
      tr.classList.add("drag-row");
      document.body.classList.add("dragging-row");
    }
    dy = Math.max((minIndex - startIndex) * rowH, Math.min((maxIndex - startIndex) * rowH, dy));
    tr.style.transform = `translateY(${dy}px)`;
    const ni = Math.max(minIndex, Math.min(maxIndex, Math.round(startIndex + dy / rowH)));
    if (ni !== curIndex) {
      curIndex = ni;
      rows.forEach((r, i) => {
        if (r === tr) return;
        let shift = 0;
        if (startIndex < curIndex && i > startIndex && i <= curIndex) shift = -rowH;
        else if (startIndex > curIndex && i >= curIndex && i < startIndex) shift = rowH;
        r.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    }
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.classList.remove("dragging-row");
    if (!moved) return;   // 클릭이었으면 표를 건드리지 않음 → 이어지는 클릭 이벤트가 행 선택 처리
    if (curIndex !== startIndex) {
      const [m] = u.payments.splice(startIndex, 1);
      u.payments.splice(curIndex, 0, m);
      save();
    }
    renderDetail();
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

// 선택 행과 같은 달을 그 아래에 추가(분할입금). 선택 없으면 현재 달.
function addPaymentSmart(u) {
  const ref = selPayments.size ? (anchorPayment || [...selPayments][0]) : null;
  let period = nowMonthKey(), insertIndex = u.payments.length;
  const refIdx = ref ? u.payments.findIndex((p) => p.id === ref) : -1;
  if (refIdx >= 0 && !u.payments[refIdx].isOpening) {
    period = u.payments[refIdx].period; insertIndex = refIdx + 1;
  } else {
    let li = -1; u.payments.forEach((p, i) => { if (p.period === period && !p.isOpening) li = i; });
    if (li >= 0) insertIndex = li + 1;
  }
  const hasExisting = u.payments.some((p) => p.period === period && !p.isOpening);
  const due = hasExisting ? 0 : expectedVAT(u, period);
  u.payments.splice(insertIndex, 0, { id: uid(), period, due, paid: 0, paidDate: null, memo: "" });
}

// "현재 달부터 입금 행 생성" — 첫 행에 과거 누적미납, 둘째 행부터 이번 달
function startLedgerFromNow(u) {
  u.payments = u.payments.filter((p) => p.isOpening || (p.paid || 0) !== 0 || p.paidDate || (p.memo || ""));
  if (!u.payments.some((p) => p.isOpening)) u.payments.push({ id: uid(), period: "", due: 0, paid: 0, paidDate: null, memo: "", isOpening: true });
  const cur = nowMonthKey();
  if (!u.payments.some((p) => p.period === cur && !p.isOpening)) u.payments.push({ id: uid(), period: cur, due: expectedVAT(u, cur), paid: 0, paidDate: null, memo: "" });
  u.payments.sort((a, b) => (a.period || "").localeCompare(b.period || ""));
}

function fillMissing(u) {
  if (u.status !== OCC || !u.startDate) return;
  const capYmd = (() => { const end = u.endDate ? ymdOf(u.endDate) : todayYmd(); return end < todayYmd() ? end : todayYmd(); })();
  const months = monthsBetween(ymdOf(u.startDate), capYmd);
  const existing = new Set(u.payments.map((p) => p.period));
  const earliest = u.payments.filter((p) => !p.isOpening).map((p) => p.period).sort()[0];
  let added = false;
  for (const m of months) { if ((!earliest || m >= earliest) && !existing.has(m)) { u.payments.push({ id: uid(), period: m, due: expectedVAT(u, m), paid: 0, paidDate: null, memo: "" }); added = true; } }
  if (added) u.payments.sort((a, b) => (a.period || "").localeCompare(b.period || ""));
}
function syncLedger(u) {
  if (u.status !== OCC || !u.startDate) return;
  const capYmd = (() => { const end = u.endDate ? ymdOf(u.endDate) : todayYmd(); return end < todayYmd() ? end : todayYmd(); })();
  const months = monthsBetween(ymdOf(u.startDate), capYmd);
  const rangeSet = new Set(months);
  const empty = (p) => (p.paid || 0) === 0 && !(p.memo || "") && !p.paidDate;
  u.payments = u.payments.filter((p) => p.isOpening || rangeSet.has(p.period) || !empty(p));
  for (const p of u.payments) if (!p.isOpening && rangeSet.has(p.period) && empty(p)) p.due = expectedVAT(u, p.period);
  const real = u.payments.filter((p) => !p.isOpening).map((p) => p.period);
  const existing = new Set(real);
  const latest = real.slice().sort().slice(-1)[0];
  for (const m of months) if (!existing.has(m) && (!latest || m > latest)) u.payments.push({ id: uid(), period: m, due: expectedVAT(u, m), paid: 0, paidDate: null, memo: "" });
  u.payments.sort((a, b) => (a.period || "").localeCompare(b.period || ""));
}

// ===== 세금계산서 알림 =====
const taxKey = (uid_, period) => uid_ + "|" + period;
const isTaxIssued = (uid_, period) => data.taxIssued.some((t) => t.unitID === uid_ && t.period === period);
function setTaxIssued(uid_, period, on) {
  if (on) { if (!isTaxIssued(uid_, period)) data.taxIssued.push({ unitID: uid_, period, issuedAt: isoOf(todayYmd()) }); }
  else data.taxIssued = data.taxIssued.filter((t) => !(t.unitID === uid_ && t.period === period));
  save();
}
function taxTargets() { const out = []; for (const b of data.buildings) for (const u of b.units) if (u.status === OCC && u.taxDay > 0) out.push({ b, u }); return out; }

function renderTax() {
  const host = document.getElementById("taxReminder");
  const tg = taxTargets();
  if (!tg.length) { host.innerHTML = ""; return; }
  const cur = nowMonthKey(); const day = new Date().getDate();
  const periods = recentMonths(3);
  const items = [];
  for (const { b, u } of tg) for (const period of periods) {
    const issued = isTaxIssued(u.id, period); const isCur = period === cur;
    if (isCur) { if (!(day >= u.taxDay || issued)) continue; } else { if (issued) continue; }
    const overdue = !issued && (!isCur || day >= u.taxDay);
    items.push({ u, b, period, issued, overdue, isPast: !isCur });
  }
  items.sort((x, y) => (x.isPast === y.isPast ? (x.u.taxDay - y.u.taxDay) : (x.isPast ? -1 : 1)));
  const need = items.filter((i) => !i.issued).length;
  const rows = items.map((i) => {
    const st = i.issued ? "발행 완료" : (i.isPast ? `${i.period} 미발행` : (i.overdue ? `발행 필요 (매달 ${i.u.taxDay}일)` : `이번 달 ${i.u.taxDay}일`));
    const cls = i.issued ? "green" : (i.overdue ? "red" : "gray");
    return `<div class="taxitem"><input type="checkbox" data-u="${i.u.id}" data-p="${i.period}" ${i.issued ? "checked" : ""}>
      <div><div>${esc(i.b.name)} ${esc([i.u.floor, i.u.unit].filter(Boolean).join(" "))}</div><div class="st ${cls}">${i.u.tenant ? esc(i.u.tenant) + " · " : ""}${st}</div></div></div>`;
  }).join("") || `<div class="muted">이번 달 발행할 항목이 없습니다.</div>`;
  host.innerHTML = `<div class="thead"><span class="ttl">세금계산서 발행</span><span>${need ? `<span class="pill">${need}건</span> ` : ""}<button id="btnTaxMonth" style="padding:2px 8px">월별</button></span></div>${rows}`;
  host.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.onchange = () => { setTaxIssued(cb.dataset.u, cb.dataset.p, cb.checked); renderTax(); });
  document.getElementById("btnTaxMonth").onclick = openTaxMonth;
}

// ===== 모달 =====
function modal(title, bodyHTML, footHTML, wide) {
  const ov = document.createElement("div"); ov.className = "overlay";
  ov.innerHTML = `<div class="modal${wide ? " wide" : ""}"><h3>${esc(title)}</h3><div class="body">${bodyHTML}</div><div class="foot">${footHTML}</div></div>`;
  // 바깥 클릭으로는 닫히지 않음 — 취소/닫기 버튼으로만 닫기 (실수 방지)
  document.getElementById("modalRoot").appendChild(ov);
  return ov;
}
function bindMoney(input) { input.addEventListener("input", () => { const c = input.selectionStart; const d = input.value.replace(/[^0-9]/g, ""); input.value = d ? parseInt(d, 10).toLocaleString("en-US") : ""; }); }

function openBuildingEditor(b) {
  const isNew = !b; const d = b || { name: "", address: "", memo: "" };
  const ov = modal(isNew ? "건물 추가" : "건물 수정",
    `<div class="field"><label>건물명 *</label><input id="e-name" value="${esc(d.name)}" placeholder="예: 강남 본사빌딩"></div>
     <div class="field"><label>주소</label><input id="e-addr" value="${esc(d.address || "")}" placeholder="예: 서울시 강남구"></div>
     <div class="field"><label>메모</label><input id="e-memo" value="${esc(d.memo || "")}"></div>`,
    `${isNew ? "" : '<button id="del" class="danger">건물 삭제</button>'}<span style="flex:1"></span><button id="c">취소</button><button id="s" class="accent">저장</button>`);
  ov.querySelector("#c").onclick = () => ov.remove();
  if (!isNew) ov.querySelector("#del").onclick = () => {
    if (confirm(`「${b.name}」 건물과 호실 ${b.units.length}개를 모두 삭제할까요?\n복구할 수 없습니다.`)) {
      data.buildings = data.buildings.filter((x) => x.id !== b.id);
      if (selBuildingId === b.id) { selBuildingId = data.buildings[0]?.id || null; selUnitId = building()?.units[0]?.id || null; }
      save(); ov.remove(); renderAll();
    }
  };
  ov.querySelector("#s").onclick = () => {
    const name = ov.querySelector("#e-name").value.trim(); if (!name) return alert("건물명을 입력하세요.");
    const obj = { name, address: ov.querySelector("#e-addr").value.trim(), memo: ov.querySelector("#e-memo").value.trim() };
    if (isNew) { const nb = { id: uid(), ...obj, units: [] }; data.buildings.push(nb); selBuildingId = nb.id; selUnitId = null; }
    else Object.assign(b, obj);
    save(); ov.remove(); renderAll();
  };
}

function openAddRoom() {
  if (!building()) return alert("먼저 건물을 선택/추가하세요.");
  const ov = modal("호실 추가",
    `<div class="frow">
       <div class="field" style="flex:0 0 120px"><label>구분</label><select id="e-base"><option value="0">지상</option><option value="1">지하</option></select></div>
       <div class="field"><label>층</label><input id="e-floor" inputmode="numeric" placeholder="예: 3"></div>
     </div>
     <div class="field"><label class="cb"><input type="checkbox" id="e-single"> 단독호실 (호실 번호 없음)</label>
       <input id="e-unit" placeholder="예: 301"></div>
     <div class="muted">세부 정보(임차인·계약·임대료)는 추가 후 오른쪽 ‘정보 수정’에서 입력하세요.</div>`,
    `<button id="c">취소</button><button id="s" class="accent">추가</button>`);
  const single = ov.querySelector("#e-single"), unitIn = ov.querySelector("#e-unit");
  single.onchange = () => { unitIn.disabled = single.checked; };
  ov.querySelector("#c").onclick = () => ov.remove();
  ov.querySelector("#s").onclick = () => {
    const num = ov.querySelector("#e-floor").value.replace(/[^0-9]/g, "");
    const base = ov.querySelector("#e-base").value === "1";
    const floor = num ? (base ? `지하${num}층` : `${num}층`) : "";
    let unitv = single.checked ? "" : unitIn.value.trim();
    if (unitv && /^[0-9]+$/.test(unitv)) unitv += "호";
    if (!floor && !unitv) return alert("층 또는 호실을 입력하세요.");
    const nu = { id: uid(), floor, unit: unitv, status: OCC, mergedInto: null, tenant: "", owner: null, phone: null, bizNo: null, taxDay: 0, bank: "", startDate: null, endDate: null, deposit: 0, rent: 0, maintMode: SAME, maintenance: 0, maintEven: 0, memo: "", businessCert: null, contract: null, payments: [] };
    building().units.push(nu); selUnitId = nu.id; save(); ov.remove(); renderAll();
  };
}

function openUnitEditor(u) {
  const bld = building();
  const kids = mergedChildren(bld, u.id);
  const cands = bld.units.filter((x) => x.id !== u.id && x.status !== MRG);
  const statusBlock = u.status === MRG
    ? `<div class="field"><label>공실 여부</label><input value="통임대 — ${esc(u.mergedInto && findUnitById(bld, u.mergedInto) ? unitName(findUnitById(bld, u.mergedInto)) + "에 포함" : "대표 호실 없음")}" disabled></div>
       <div class="field"><button id="e-unmerge">통임대 해제 (공실로)</button></div>`
    : `<div class="field"><label>공실 여부</label><select id="e-status"><option ${u.status === OCC ? "selected" : ""}>${OCC}</option><option ${u.status === VAC ? "selected" : ""}>${VAC}</option></select></div>
       <div class="field"><label>통임대로 묶기</label><select id="e-merge"><option value="">사용 안 함</option>${cands.map((c) => `<option value="${c.id}">${esc(unitName(c))}에 포함시키기</option>`).join("")}</select>
         <div class="muted">한 임차인이 여러 호실을 함께 쓸 때 사용합니다. 묶은 호실은 공실·미납 통계에서 빠지고, 엑셀에서는 대표 호실과 병합되어 표시됩니다.</div></div>
       ${kids.length ? `<div class="field"><label>포함된 호실</label><input value="${esc(kids.map(unitName).join(", "))}" disabled></div>` : ""}`;
  const ov = modal(`호실 정보 수정 — ${[u.floor, u.unit].filter(Boolean).join(" ")}`,
    statusBlock +
    `<div class="field"><label>임차인</label><input id="e-tenant" value="${esc(u.tenant || "")}" placeholder="예: (주)○○상사"></div>
     <div class="frow"><div class="field"><label>대표자</label><input id="e-owner" value="${esc(u.owner || "")}" placeholder="예: 홍길동"></div>
       <div class="field"><label>연락처</label><input id="e-phone" value="${esc(u.phone || "")}" placeholder="숫자만 입력하면 자동 하이픈"></div></div>
     <div class="field"><label>사업자등록번호</label><input id="e-bizno" value="${esc(u.bizNo || "")}" placeholder="숫자만 입력하면 자동 하이픈"></div>
     <div class="frow"><div class="field"><label>세금계산서 발행일 (매달 N일)</label><input id="e-tax" inputmode="numeric" value="${u.taxDay || ""}" placeholder="예: 1"></div>
       <div class="field"><label>입금은행</label><input id="e-bank" value="${esc(u.bank || "")}" placeholder="예: 국민은행"></div></div>
     <div class="frow"><div class="field"><label>계약 시작일</label><input type="date" id="e-start" value="${ymdOf(u.startDate)}"></div>
       <div class="field"><label>계약 종료일</label><input type="date" id="e-end" value="${ymdOf(u.endDate)}"></div></div>
     <div class="frow"><div class="field"><label>보증금 (원)</label><input id="e-deposit" inputmode="numeric" value="${u.deposit ? won(u.deposit) : ""}"></div>
       <div class="field"><label>월세 (원)</label><input id="e-rent" inputmode="numeric" value="${u.rent ? won(u.rent) : ""}"></div></div>
     <div class="field"><label>관리비 (원)</label><input id="e-maint" inputmode="numeric" value="${u.maintenance ? won(u.maintenance) : ""}"></div>
     <div class="field"><label class="cb"><input type="checkbox" id="e-usecommon" ${hasCommon(u) ? "checked" : ""}> 공용요금 따로 청구 (공동수도·공동전기) — 홀수달·짝수달 금액이 다를 때</label></div>
     <div class="frow" id="wrap-common"><div class="field"><label>공용요금 · 홀수달 (원)</label><input id="e-codd" inputmode="numeric" value="${u.commonOdd ? won(u.commonOdd) : ""}"></div>
       <div class="field"><label>공용요금 · 짝수달 (원)</label><input id="e-ceven" inputmode="numeric" value="${u.commonEven ? won(u.commonEven) : ""}"></div></div>
     <div class="field"><label class="cb"><input type="checkbox" id="e-gennow"> 현재 달부터 입금 행 생성 — 첫 행에 과거 누적미납 입력, 둘째 행부터 이번 달</label></div>
     <div class="field"><label>메모</label><input id="e-memo" value="${esc(u.memo || "")}"></div>`,
    `<button id="c">취소</button><button id="s" class="accent">저장</button>`);
  ["e-deposit", "e-rent", "e-maint", "e-codd", "e-ceven"].forEach((id) => bindMoney(ov.querySelector("#" + id)));
  // 연락처·사업자등록번호 자동 하이픈
  const phoneIn = ov.querySelector("#e-phone"), bizIn = ov.querySelector("#e-bizno");
  phoneIn.addEventListener("input", () => { phoneIn.value = formatPhone(phoneIn.value); });
  bizIn.addEventListener("input", () => { bizIn.value = formatBizNo(bizIn.value); });
  const status = ov.querySelector("#e-status"), useCommon = ov.querySelector("#e-usecommon");
  const mergeSel = ov.querySelector("#e-merge"), unmergeBtn = ov.querySelector("#e-unmerge");
  const lockFields = ["e-tenant", "e-owner", "e-phone", "e-bizno", "e-tax", "e-bank", "e-start", "e-end", "e-deposit"];
  const applyStatus = () => {
    const occ = status ? status.value === OCC : false;
    const locked = !occ || (mergeSel && mergeSel.value);
    lockFields.forEach((id) => ov.querySelector("#" + id).disabled = !!locked);
  };
  const applyCommon = () => { ov.querySelector("#wrap-common").style.display = useCommon.checked ? "" : "none"; };
  if (status) status.onchange = applyStatus;
  if (mergeSel) mergeSel.onchange = applyStatus;
  useCommon.onchange = applyCommon; applyStatus(); applyCommon();
  if (unmergeBtn) unmergeBtn.onclick = () => { unmergeUnit(bld, u.id); save(); ov.remove(); renderAll(); };
  ov.querySelector("#c").onclick = () => ov.remove();
  ov.querySelector("#s").onclick = () => {
    if (mergeSel && mergeSel.value) { mergeUnit(bld, u.id, mergeSel.value); save(); ov.remove(); renderAll(); return; }
    if (u.status === MRG) { ov.remove(); return; }
    if (status.value === VAC) releaseMergedChildren(bld, u.id);
    u.status = status.value; u.tenant = ov.querySelector("#e-tenant").value.trim();
    u.owner = ov.querySelector("#e-owner").value.trim() || null;
    u.phone = phoneIn.value.trim() || null;
    u.bizNo = bizIn.value.trim() || null;
    u.taxDay = Math.min(Math.max(parseNum(ov.querySelector("#e-tax").value), 0), 31);
    u.bank = ov.querySelector("#e-bank").value.trim();
    u.startDate = isoOf(ov.querySelector("#e-start").value); u.endDate = isoOf(ov.querySelector("#e-end").value);
    u.deposit = parseNum(ov.querySelector("#e-deposit").value); u.rent = parseNum(ov.querySelector("#e-rent").value);
    u.maintenance = parseNum(ov.querySelector("#e-maint").value);
    u.maintMode = SAME; u.maintEven = 0;
    u.commonOdd = useCommon.checked ? parseNum(ov.querySelector("#e-codd").value) : null;
    u.commonEven = useCommon.checked ? parseNum(ov.querySelector("#e-ceven").value) : null;
    u.memo = ov.querySelector("#e-memo").value.trim();
    if (ov.querySelector("#e-gennow").checked && u.status === OCC) startLedgerFromNow(u);
    syncLedger(u); save(); ov.remove(); renderAll();
  };
}

// ===== 퇴실 / 보관함 =====
function openMoveOut() {
  const u = unit(), b = building(); if (!u) return alert("호실을 선택하세요."); if (u.status === VAC) return alert("이미 공실입니다.");
  const ov = modal("퇴실 처리",
    `<div class="muted">${esc(b.name)} ${esc([u.floor, u.unit].filter(Boolean).join(" "))} · 임차인 ${esc(u.tenant || "—")}</div>
     <div class="field"><label>퇴실일</label><input type="date" id="e-date" value="${todayYmd()}"></div>
     <div class="field"><label>메모</label><input id="e-memo" placeholder="정산 결과 등"></div>
     <div class="muted">호실은 공실로 바뀌고, 임차인·계약·입금내역은 보관함에 저장됩니다.</div>`,
    `<button id="c">취소</button><button id="s" class="accent">퇴실 처리</button>`);
  ov.querySelector("#c").onclick = () => ov.remove();
  ov.querySelector("#s").onclick = () => {
    const td = u.payments.reduce((s, p) => s + (p.due || 0), 0), tp = u.payments.reduce((s, p) => s + (p.paid || 0), 0);
    data.moveOuts.unshift({ id: uid(), buildingName: b.name, floor: u.floor, unit: u.unit, tenant: u.tenant, owner: u.owner, phone: u.phone, bizNo: u.bizNo, bank: u.bank, taxDay: u.taxDay, startDate: u.startDate, endDate: u.endDate, deposit: u.deposit, rent: u.rent, maintenance: u.maintenance, maintMode: u.maintMode, maintEven: u.maintEven, commonOdd: u.commonOdd, commonEven: u.commonEven, totalDue: td, totalPaid: tp, unpaid: td - tp, moveOutDate: isoOf(ov.querySelector("#e-date").value), memo: ov.querySelector("#e-memo").value.trim(), archivedAt: isoOf(todayYmd()), payments: u.payments });
    releaseMergedChildren(b, u.id);
    Object.assign(u, { status: VAC, tenant: "", owner: null, phone: null, bizNo: null, bank: "", taxDay: 0, startDate: null, endDate: null, deposit: 0, payments: [] });
    save(); ov.remove(); renderAll();
  };
}

function openArchive() {
  const list = data.moveOuts;
  const rowsHTML = list.length ? list.map((m) => `<tr data-id="${m.id}"><td>${ymdOf(m.moveOutDate)}</td><td>${esc(m.buildingName)}</td><td>${esc([m.floor, m.unit].filter(Boolean).join(" "))}</td><td>${esc(m.tenant)}</td><td class="num ${m.unpaid > 0 ? "red" : ""}">${m.unpaid > 0 ? won(m.unpaid) : "—"}</td></tr>`).join("") : `<tr><td colspan="5" class="muted" style="padding:30px">보관된 퇴실 임차인이 없습니다.</td></tr>`;
  const ov = modal("퇴실 임차인 보관함",
    `<table class="ledger"><thead><tr><th>퇴실일</th><th>건물</th><th>호실</th><th>임차인</th><th>미납</th></tr></thead><tbody id="arows">${rowsHTML}</tbody></table>
     <div id="adetail" class="muted" style="margin-top:8px"></div>`,
    `<button id="del" class="danger">선택 영구 삭제</button><span style="flex:1"></span><button id="c" class="accent">닫기</button>`, true);
  let sel = null;
  ov.querySelectorAll("#arows tr[data-id]").forEach((tr) => tr.onclick = () => {
    sel = tr.dataset.id; ov.querySelectorAll("#arows tr").forEach((t) => t.classList.remove("sel")); tr.classList.add("sel");
    const m = list.find((x) => x.id === sel);
    ov.querySelector("#adetail").innerHTML = `<b>${esc(m.buildingName)} ${esc([m.floor, m.unit].filter(Boolean).join(" "))}</b> · 임차인 ${esc(m.tenant)} · 대표자 ${esc(m.owner || "—")} · 연락처 ${esc(m.phone || "—")}<br>사업자등록번호 ${esc(m.bizNo || "—")} · 은행 ${esc(m.bank || "—")}<br>계약 ${ymdOf(m.startDate)}~${ymdOf(m.endDate)} · 보증금 ${won(m.deposit)} · 월세 ${won(m.rent)}<br>총예정 ${won(m.totalDue)} / 총입금 ${won(m.totalPaid)} / 미납 ${won(m.unpaid)} · 메모 ${esc(m.memo || "—")}`;
  });
  ov.querySelector("#c").onclick = () => ov.remove();
  ov.querySelector("#del").onclick = () => { if (!sel) return alert("삭제할 항목을 선택하세요."); if (confirm("영구 삭제할까요? 복구할 수 없습니다.")) { data.moveOuts = data.moveOuts.filter((m) => m.id !== sel); save(); ov.remove(); openArchive(); } };
}

// ===== 세금계산서 월별 =====
let taxViewMonth = nowMonthKey();
function openTaxMonth() {
  const render = () => {
    const [y, m] = taxViewMonth.split("-").map(Number);
    const byDay = {}; for (const { b, u } of taxTargets()) { (byDay[u.taxDay] ||= []).push({ b, u }); }
    const days = Object.keys(byDay).map(Number).sort((a, c) => a - c);
    const cur = nowMonthKey(), today = new Date().getDate();
    let total = 0, issuedN = 0;
    const sections = days.map((day) => {
      const items = byDay[day].sort((x, z) => x.b.name.localeCompare(z.b.name));
      const lines = items.map(({ b, u }) => {
        total++; const issued = isTaxIssued(u.id, taxViewMonth); if (issued) issuedN++;
        let late = false; if (taxViewMonth < cur) late = !issued; else if (taxViewMonth === cur) late = !issued && today >= day;
        const st = issued ? "발행 완료" : (taxViewMonth < cur ? "미발행 (놓침)" : (taxViewMonth > cur ? "예정" : (late ? "발행 필요" : "예정")));
        const cls = issued ? "green" : (late ? "red" : "gray");
        return `<div class="taxitem"><input type="checkbox" data-u="${u.id}" ${issued ? "checked" : ""}><div><div>${esc(b.name)} ${esc([u.floor, u.unit].filter(Boolean).join(" "))} ${u.tenant ? "· " + esc(u.tenant) : ""}</div><div class="st ${cls}">${st}</div></div></div>`;
      }).join("");
      return `<div style="margin:8px 0"><div style="font-weight:600;margin-bottom:4px">매달 ${day}일</div>${lines}</div>`;
    }).join("") || `<div class="muted" style="padding:20px">발행 대상 호실이 없습니다.</div>`;
    ov.querySelector(".body").innerHTML =
      `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <button id="prev">◀</button><b style="min-width:110px;text-align:center">${y}년 ${m}월</b><button id="next">▶</button>
        <button id="cur">이번 달</button><span style="flex:1"></span><span class="muted">발행 ${issuedN} / 대상 ${total}</span></div>${sections}`;
    ov.querySelector("#prev").onclick = () => { let yy = y, mm = m - 1; if (mm === 0) { yy--; mm = 12; } taxViewMonth = `${yy}-${String(mm).padStart(2, "0")}`; render(); };
    ov.querySelector("#next").onclick = () => { let yy = y, mm = m + 1; if (mm === 13) { yy++; mm = 1; } taxViewMonth = `${yy}-${String(mm).padStart(2, "0")}`; render(); };
    ov.querySelector("#cur").onclick = () => { taxViewMonth = nowMonthKey(); render(); };
    ov.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.onchange = () => { setTaxIssued(cb.dataset.u, taxViewMonth, cb.checked); render(); renderTax(); });
  };
  const ov = modal("세금계산서 발행 현황", "", `<button id="c" class="accent">닫기</button>`, true);
  ov.querySelector("#c").onclick = () => ov.remove();
  render();
}

// ===== 첨부 =====
async function attachAction(u, kind, field, label) {
  const cur = u[field];
  if (cur) {
    const ov = modal(label, `<div class="muted">첨부됨: ${esc(cur.split(/[\\/]/).pop())}</div>`,
      `<button id="open">미리보기</button><button id="ext">기본앱으로 열기</button><button id="save">저장</button><button id="re">다시 첨부</button><button id="rm" class="danger">첨부 제거</button><button id="c" class="accent">닫기</button>`);
    ov.querySelector("#c").onclick = () => ov.remove();
    ov.querySelector("#open").onclick = () => { ov.remove(); previewFile(cur, label); };
    ov.querySelector("#ext").onclick = () => window.api.openFile(cur);
    ov.querySelector("#save").onclick = () => window.api.saveAttachmentCopy(cur);
    ov.querySelector("#re").onclick = async () => { const p = await window.api.attach(u.id, kind); if (p) { u[field] = p; save(); } ov.remove(); renderDetail(); };
    ov.querySelector("#rm").onclick = () => { window.api.removeFile(cur); u[field] = null; save(); ov.remove(); renderDetail(); };
  } else {
    const p = await window.api.attach(u.id, kind); if (p) { u[field] = p; save(); renderDetail(); }
  }
}
function previewFile(p, label) {
  const url = "file://" + p.replace(/\\/g, "/");
  const isPdf = /\.pdf$/i.test(p);
  const ov = modal(label, `<div class="previewbox">${isPdf ? `<iframe src="${url}"></iframe>` : `<img src="${url}">`}</div>`,
    `<button id="ext">기본앱으로 열기</button><button id="c" class="accent">닫기</button>`, true);
  ov.querySelector("#c").onclick = () => ov.remove();
  ov.querySelector("#ext").onclick = () => window.api.openFile(p);
}

// ===== 엑셀 내보내기 (세무사 제출용) =====
function openExcelExport() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curQ = Math.floor(now.getMonth() / 3) + 1;
  const saved = localStorage.getItem("excelCompanyName") || "조아조아(주)";
  const years = [];
  for (let y = curYear + 1; y >= curYear - 5; y--) years.push(y);

  const ov = modal("엑셀 내보내기 (세무사 제출용)",
    `<div class="field"><label>회사명</label><input id="x-company" value="${esc(saved)}" placeholder="예: 조아조아(주)"></div>
     <div class="frow">
       <div class="field"><label>연도</label><select id="x-year">${years.map((y) => `<option value="${y}" ${y === curYear ? "selected" : ""}>${y}년</option>`).join("")}</select></div>
       <div class="field"><label>분기</label><select id="x-q">${[1, 2, 3, 4].map((q) => `<option value="${q}" ${q === curQ ? "selected" : ""}>${q}분기</option>`).join("")}</select></div>
     </div>
     <div class="muted" id="x-info"></div>`,
    `<button id="c">취소</button><button id="s" class="accent">엑셀 만들기</button>`);

  const info = ov.querySelector("#x-info");
  const refresh = () => {
    const y = +ov.querySelector("#x-year").value, q = +ov.querySelector("#x-q").value;
    const ms = quarterMonths(y, q);
    info.innerHTML = `제목: <b>${esc(ov.querySelector("#x-company").value)} ${y}년 ${q}분기 임대현황</b><br>
      시트1 · 임대현황: 전체 건물 (공실 포함)<br>시트2 · 입금내역: ${ms[0]} ~ ${ms[2]}`;
  };
  ov.querySelector("#x-year").onchange = refresh;
  ov.querySelector("#x-q").onchange = refresh;
  ov.querySelector("#x-company").oninput = refresh;
  refresh();

  ov.querySelector("#c").onclick = () => ov.remove();
  ov.querySelector("#s").onclick = async () => {
    const company = ov.querySelector("#x-company").value.trim() || "회사";
    const y = +ov.querySelector("#x-year").value, q = +ov.querySelector("#x-q").value;
    localStorage.setItem("excelCompanyName", company);
    try {
      const bytes = buildExcel(data, y, q, company);
      const ok = await window.api.exportExcel(Array.from(bytes), `${company} ${y}년 ${q}분기 임대현황.xlsx`);
      if (ok) ov.remove();
    } catch (err) {
      alert("엑셀 파일을 만들지 못했습니다.\n" + err.message);
    }
  };
}

// ===== 백업 / 이동 =====
function openBackup() {
  const ov = modal("백업 / 다른 컴퓨터로 이동",
    `<div class="muted">모든 데이터(건물·호실·입금내역·세금계산서 기록·퇴실 보관함)와 <b>첨부파일(사업자등록증·계약서)</b>을
     파일 하나(.zip)로 내보내고, 다른 컴퓨터(윈도우·맥 어느 쪽이든)의 RentDesk에서 「백업 불러오기」로 그대로 복원할 수 있습니다.<br><br>
     ※ 프로그램을 새 버전으로 재설치해도 데이터는 지워지지 않지만, 만약을 위해 업데이트 전 백업을 권장합니다.</div>`,
    `<button id="exp" class="accent">백업 내보내기</button><button id="imp">백업 불러오기</button><span style="flex:1"></span><button id="c">닫기</button>`);
  ov.querySelector("#c").onclick = () => ov.remove();
  ov.querySelector("#exp").onclick = async () => {
    // 첨부 경로는 파일명만 남겨 저장 (다른 컴퓨터에서도 찾을 수 있게)
    const snapshot = JSON.parse(JSON.stringify(data));
    const attachPaths = [];
    for (const b of snapshot.buildings) {
      for (const u of b.units) {
        for (const k of ["businessCert", "contract"]) {
          if (u[k]) { attachPaths.push(u[k]); u[k] = u[k].split(/[\\/]/).pop(); }
        }
      }
    }
    const ok = await window.api.exportBackup(JSON.stringify(snapshot, null, 2), `RentDesk-백업_${todayYmd()}.zip`, attachPaths);
    if (ok) { alert("데이터와 첨부파일을 모두 백업했습니다."); ov.remove(); }
  };
  ov.querySelector("#imp").onclick = async () => {
    const res = await window.api.importBackup();
    if (!res) return;
    let parsed;
    try { parsed = JSON.parse(String(res.json).replace(/^﻿/, "")); } catch { return alert("RentDesk 백업 파일이 아니거나 읽을 수 없습니다."); }
    if (!Array.isArray(parsed.buildings)) return alert("RentDesk 백업 파일이 아닙니다.");
    // 복원된 첨부파일 경로 다시 연결
    const restored = res.restored || {};
    for (const b of parsed.buildings) {
      for (const u of b.units || []) {
        for (const k of ["businessCert", "contract"]) {
          if (!u[k]) continue;
          const base = String(u[k]).split(/[\\/]/).pop();
          if (restored[base]) u[k] = restored[base];
        }
      }
    }
    if (!confirm("현재 이 컴퓨터의 데이터가 백업 파일 내용으로 전부 교체됩니다.\n계속할까요?")) return;
    data = parsed;
    data.buildings ||= []; data.moveOuts ||= []; data.taxIssued ||= [];
    selBuildingId = data.buildings[0]?.id || null;
    selUnitId = building()?.units[0]?.id || null;
    selPayments.clear();
    save(); ov.remove(); renderAll();
    alert("백업을 불러왔습니다.");
  };
}

// ===== CSV =====
function exportCSV() {
  const head = ["건물명", "층", "호실", "상태", "임차인", "대표자", "연락처", "사업자등록번호", "입금은행", "세금계산서발행일", "계약시작일", "계약종료일", "보증금", "월세", "관리비", "공용요금(홀)", "공용요금(짝)", "입금월", "입금예정액", "실입금액", "실입금일", "당월미납", "메모"];
  const lines = [head];
  for (const b of data.buildings) for (const u of b.units) {
    const base = [b.name, u.floor, u.unit, u.status, u.tenant, u.owner || "", u.phone || "", u.bizNo || "", u.bank || "", u.taxDay > 0 ? `매달 ${u.taxDay}일` : "", ymdOf(u.startDate), ymdOf(u.endDate), u.deposit, u.rent, u.maintenance, u.commonOdd || 0, u.commonEven || 0];
    if (!u.payments.length) lines.push(base.concat(["", "", "", "", "", ""]));
    else for (const p of u.payments) lines.push(base.concat([p.period, p.due, p.paid, ymdOf(p.paidDate), (p.due || 0) - (p.paid || 0), p.memo || ""]));
  }
  const csv = lines.map((r) => r.map((f) => { const s = String(f ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
  window.api.exportCsv(csv, `RentDesk_${todayYmd()}.csv`);
}

// ===== 시작 =====
document.getElementById("btnAddBuilding").onclick = () => openBuildingEditor(null);
document.getElementById("btnAddUnit").onclick = openAddRoom;
document.getElementById("btnDelUnit").onclick = () => { const u = unit(); if (!u) return alert("호실을 선택하세요."); if (confirm(`「${[u.floor, u.unit].filter(Boolean).join(" ")}」 호실을 삭제할까요?`)) { releaseMergedChildren(building(), u.id); building().units = building().units.filter((x) => x.id !== u.id); selUnitId = building().units[0]?.id || null; save(); renderAll(); } };
document.getElementById("btnMoveOut").onclick = openMoveOut;
document.getElementById("btnTax").onclick = openTaxMonth;
document.getElementById("btnArchive").onclick = openArchive;
document.getElementById("btnCsv").onclick = exportCSV;
document.getElementById("btnExcel").onclick = openExcelExport;
document.getElementById("btnBackup").onclick = openBackup;

// ===== 창 크기 드래그 조절 =====
function setupResizers() {
  const colDrag = (sep, target, min, max) => {
    sep.addEventListener("mousedown", (e) => {
      e.preventDefault(); const sx = e.clientX, sw = target.offsetWidth; document.body.style.cursor = "col-resize";
      const mv = (ev) => { let w = Math.max(min, Math.min(max, sw + (ev.clientX - sx))); target.style.width = w + "px"; };
      const up = () => { document.body.style.cursor = ""; document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
      document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
    });
  };
  colDrag(document.getElementById("sep1"), document.getElementById("sidebar"), 190, 460);
  colDrag(document.getElementById("sep2"), document.getElementById("unitcol"), 240, 640);
  const tax = document.getElementById("taxReminder");
  document.getElementById("taxsep").addEventListener("mousedown", (e) => {
    e.preventDefault(); const sy = e.clientY, sh = tax.offsetHeight; document.body.style.cursor = "row-resize";
    const mv = (ev) => { let h = Math.max(54, Math.min(window.innerHeight - 200, sh - (ev.clientY - sy))); tax.style.height = h + "px"; tax.style.maxHeight = "none"; };
    const up = () => { document.body.style.cursor = ""; document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
  });
}
setupResizers();

load().then(renderAll);
