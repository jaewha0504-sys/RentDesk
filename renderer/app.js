"use strict";

// ===== 상태 =====
let data = { buildings: [], moveOuts: [], taxIssued: [] };
let selBuildingId = null, selUnitId = null;
let selPayments = new Set(), anchorPayment = null;
let saveTimer = null;

const OCC = "임대중", VAC = "공실", SAME = "짝/홀수달 동일", DIFF = "짝/홀수달 상이";

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

function maintFor(u, period) {
  if ((u.maintMode || SAME) === DIFF) { const mm = parseInt(period.split("-")[1], 10) || 1; return mm % 2 === 0 ? (u.maintEven || 0) : (u.maintenance || 0); }
  return u.maintenance || 0;
}
const expectedFor = (u, p) => (u.rent || 0) + maintFor(u, p);
const expectedVAT = (u, p) => withVAT(expectedFor(u, p));
const unpaidTotal = (u) => (u.payments || []).reduce((s, p) => s + (p.due || 0) - (p.paid || 0), 0);

const building = () => data.buildings.find((b) => b.id === selBuildingId) || null;
const unit = () => { const b = building(); return b ? (b.units.find((x) => x.id === selUnitId) || null) : null; };
function findUnit(id) { for (const b of data.buildings) { const u = b.units.find((x) => x.id === id); if (u) return u; } return null; }

// ===== 저장/로드 =====
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => window.api.save(JSON.stringify(data, null, 2)), 300); }
async function load() {
  const raw = await window.api.load();
  if (raw) { try { data = JSON.parse(raw); } catch { data = { buildings: [], moveOuts: [], taxIssued: [] }; } }
  data.buildings ||= []; data.moveOuts ||= []; data.taxIssued ||= [];
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
  const U = (o) => Object.assign({ id: uid(), floor: "", unit: "", status: OCC, tenant: "", taxDay: 0, bank: "", startDate: null, endDate: null, deposit: 0, rent: 0, maintMode: SAME, maintenance: 0, maintEven: 0, memo: "", businessCert: null, contract: null, payments: [] }, o);
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
    const nm = [u.floor, u.unit].filter(Boolean).join(" ") || "(호실)";
    let right = u.status === VAC ? '<span class="badge">공실</span>' : (up > 0 ? `<span class="unpaid">미납 ${won(up)}</span>` : "");
    li.innerHTML = `<span class="right">${right}</span><div class="name">${esc(nm)}</div><div class="sub">${u.status === VAC ? "공실" : esc(u.tenant || "임차인 미입력")}</div>`;
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
function maintText(u) { return u.maintMode === DIFF ? `홀수달 ${vatPair(u.maintenance)}\n짝수달 ${vatPair(u.maintEven)}` : vatPair(u.maintenance); }
function expectedText(u) { return u.maintMode === DIFF ? `홀수달 ${vatPair((u.rent || 0) + (u.maintenance || 0))}\n짝수달 ${vatPair((u.rent || 0) + (u.maintEven || 0))}` : vatPair((u.rent || 0) + (u.maintenance || 0)); }
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
      <div><div class="bn">${esc(b.name)}</div><div class="rn">${esc([u.floor, u.unit].filter(Boolean).join(" ") || "(호실)")}</div></div>
      <span class="statusbadge ${u.status === VAC ? "vac" : "occ"}">${u.status}</span>
      <span class="sp"></span>
      <button id="btnBiz">${u.businessCert ? "✓ 사업자등록증" : "📎 사업자등록증"}</button>
      <button id="btnContract">${u.contract ? "✓ 계약서" : "📎 계약서"}</button>
      <button id="btnEditUnit" class="accent">정보 수정</button>
    </div>`;
  if (u.status === VAC) {
    host.innerHTML = head + `<div class="vacant-note">이 호실은 현재 공실입니다.<br>‘정보 수정’에서 임대중으로 바꾸면 정보·입금내역이 표시됩니다.</div>`;
  } else {
    const info = `<div class="infocard">
      <div class="inforow"><span class="lab">임차인</span><span class="val">${esc(u.tenant || "—")}</span></div>
      <div class="inforow"><span class="lab">보증금</span><span class="val">${wonStr(u.deposit)}</span></div>
      <div class="inforow"><span class="lab">입금은행</span><span class="val">${esc(u.bank || "—")}</span></div>
      <div class="inforow"><span class="lab">월세</span><span class="val">${vatPair(u.rent)}</span></div>
      <div class="inforow"><span class="lab">세금계산서 발행일</span><span class="val">${u.taxDay > 0 ? "매달 " + u.taxDay + "일" : "—"}</span></div>
      <div class="inforow"><span class="lab">관리비</span><span class="val">${maintText(u)}</span></div>
      <div class="inforow"><span class="lab">계약기간</span><span class="val">${periodText(u)}</span></div>
      <div class="inforow"><span class="lab">총 입금예정금액</span><span class="val">${expectedText(u)}</span></div>
    </div>`;
    host.innerHTML = head + info + ledgerHTML(u);
    wireLedger(u);
  }
  document.getElementById("btnEditUnit").onclick = () => openUnitEditor(u);
  document.getElementById("btnBiz").onclick = () => attachAction(u, "biz", "businessCert", "사업자등록증");
  document.getElementById("btnContract").onclick = () => attachAction(u, "contract", "contract", "계약서");
}

function ledgerHTML(u) {
  let cum = 0;
  const rows = (u.payments || []).map((p) => {
    const tu = (p.due || 0) - (p.paid || 0); cum += tu;
    const selc = selPayments.has(p.id) ? " class=\"sel\"" : "";
    return `<tr data-id="${p.id}"${selc}>
      <td>${esc(p.period)}</td>
      <td><input class="num d-due" inputmode="numeric" value="${won(p.due)}"></td>
      <td><input class="num d-paid" inputmode="numeric" value="${p.paid ? won(p.paid) : ""}"></td>
      <td><input type="date" class="d-date" value="${ymdOf(p.paidDate)}"></td>
      <td class="num ${tu > 0 ? "red" : ""}">${tu !== 0 ? won(tu) : "—"}</td>
      <td class="num ${cum > 0 ? "red" : ""}">${cum !== 0 ? won(cum) : "—"}</td>
      <td><input class="d-memo" value="${esc(p.memo || "")}"></td>
    </tr>`;
  }).join("");
  return `<div class="ledger-head"><h2>월별 입금내역</h2><span class="muted">셀을 클릭해 바로 수정 · Cmd/Shift로 복수선택</span><span class="sp"></span>
      <button id="btnFill">빠진 달 채우기</button>
      <button id="btnDelPay" class="danger">행 삭제</button>
      <button id="btnAddPay" class="accent">+ 입금내역 추가</button></div>
    <table class="ledger"><thead><tr>
      <th>입금월</th><th>입금예정액</th><th>실입금액</th><th>실입금일</th><th>당월미납</th><th>누적미납</th><th>메모</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function wireLedger(u) {
  document.getElementById("btnAddPay").onclick = () => {
    const pays = u.payments; const period = pays.length ? nextMonth(pays[pays.length - 1].period) : nowMonthKey();
    pays.push({ id: uid(), period, due: expectedVAT(u, period), paid: 0, paidDate: null, memo: "" });
    save(); renderAll();
  };
  document.getElementById("btnFill").onclick = () => { fillMissing(u); save(); renderAll(); };
  document.getElementById("btnDelPay").onclick = () => {
    if (!selPayments.size) return alert("삭제할 행을 선택하세요.");
    u.payments = u.payments.filter((p) => !selPayments.has(p.id)); selPayments.clear(); save(); renderAll();
  };
  document.querySelectorAll("#detailBody tbody tr").forEach((tr) => {
    const id = tr.dataset.id; const p = u.payments.find((x) => x.id === id);
    tr.querySelector(".d-due").onchange = (e) => { p.due = parseNum(e.target.value); save(); renderDetail(); };
    const paidInput = tr.querySelector(".d-paid");
    paidInput.onchange = (e) => { p.paid = parseNum(e.target.value); if (p.paid > 0 && !p.paidDate) p.paidDate = isoOf(todayYmd()); save(); renderDetail(); };
    tr.querySelector(".d-date").onchange = (e) => { p.paidDate = e.target.value ? isoOf(e.target.value) : null; save(); };
    tr.querySelector(".d-memo").onchange = (e) => { p.memo = e.target.value; save(); };
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

function fillMissing(u) {
  if (u.status !== OCC || !u.startDate) return;
  const capYmd = (() => { const end = u.endDate ? ymdOf(u.endDate) : todayYmd(); return end < todayYmd() ? end : todayYmd(); })();
  const months = monthsBetween(ymdOf(u.startDate), capYmd);
  const existing = new Set(u.payments.map((p) => p.period));
  const earliest = u.payments.map((p) => p.period).sort()[0];
  let added = false;
  for (const m of months) { if ((!earliest || m >= earliest) && !existing.has(m)) { u.payments.push({ id: uid(), period: m, due: expectedVAT(u, m), paid: 0, paidDate: null, memo: "" }); added = true; } }
  if (added) u.payments.sort((a, b) => a.period.localeCompare(b.period));
}
function syncLedger(u) {
  if (u.status !== OCC || !u.startDate) return;
  const capYmd = (() => { const end = u.endDate ? ymdOf(u.endDate) : todayYmd(); return end < todayYmd() ? end : todayYmd(); })();
  const months = monthsBetween(ymdOf(u.startDate), capYmd);
  const rangeSet = new Set(months);
  const empty = (p) => (p.paid || 0) === 0 && !(p.memo || "") && !p.paidDate;
  u.payments = u.payments.filter((p) => rangeSet.has(p.period) || !empty(p));
  for (const p of u.payments) if (rangeSet.has(p.period) && empty(p)) p.due = expectedVAT(u, p.period);
  const existing = new Set(u.payments.map((p) => p.period));
  const latest = u.payments.map((p) => p.period).sort().slice(-1)[0];
  for (const m of months) if (!existing.has(m) && (!latest || m > latest)) u.payments.push({ id: uid(), period: m, due: expectedVAT(u, m), paid: 0, paidDate: null, memo: "" });
  u.payments.sort((a, b) => a.period.localeCompare(b.period));
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
      <div><div>${esc(i.b.name)} ${esc([i.u.floor, i.u.unit].filter(Boolean).join(" "))}</div><div class="st ${cls}">${st}</div></div></div>`;
  }).join("") || `<div class="muted">이번 달 발행할 항목이 없습니다.</div>`;
  host.innerHTML = `<div class="thead"><span class="ttl">세금계산서 발행</span><span>${need ? `<span class="pill">${need}건</span> ` : ""}<button id="btnTaxMonth" style="padding:2px 8px">월별</button></span></div>${rows}`;
  host.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.onchange = () => { setTaxIssued(cb.dataset.u, cb.dataset.p, cb.checked); renderTax(); });
  document.getElementById("btnTaxMonth").onclick = openTaxMonth;
}

// ===== 모달 =====
function modal(title, bodyHTML, footHTML, wide) {
  const ov = document.createElement("div"); ov.className = "overlay";
  ov.innerHTML = `<div class="modal${wide ? " wide" : ""}"><h3>${esc(title)}</h3><div class="body">${bodyHTML}</div><div class="foot">${footHTML}</div></div>`;
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
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
    const nu = { id: uid(), floor, unit: unitv, status: OCC, tenant: "", taxDay: 0, bank: "", startDate: null, endDate: null, deposit: 0, rent: 0, maintMode: SAME, maintenance: 0, maintEven: 0, memo: "", businessCert: null, contract: null, payments: [] };
    building().units.push(nu); selUnitId = nu.id; save(); ov.remove(); renderAll();
  };
}

function openUnitEditor(u) {
  const ov = modal(`호실 정보 수정 — ${[u.floor, u.unit].filter(Boolean).join(" ")}`,
    `<div class="field"><label>공실 여부</label><select id="e-status"><option ${u.status === OCC ? "selected" : ""}>${OCC}</option><option ${u.status === VAC ? "selected" : ""}>${VAC}</option></select></div>
     <div class="field"><label>임차인</label><input id="e-tenant" value="${esc(u.tenant || "")}" placeholder="예: (주)○○상사"></div>
     <div class="frow"><div class="field"><label>세금계산서 발행일 (매달 N일)</label><input id="e-tax" inputmode="numeric" value="${u.taxDay || ""}" placeholder="예: 1"></div>
       <div class="field"><label>입금은행</label><input id="e-bank" value="${esc(u.bank || "")}" placeholder="예: 국민은행"></div></div>
     <div class="frow"><div class="field"><label>계약 시작일</label><input type="date" id="e-start" value="${ymdOf(u.startDate)}"></div>
       <div class="field"><label>계약 종료일</label><input type="date" id="e-end" value="${ymdOf(u.endDate)}"></div></div>
     <div class="frow"><div class="field"><label>보증금 (원)</label><input id="e-deposit" inputmode="numeric" value="${u.deposit ? won(u.deposit) : ""}"></div>
       <div class="field"><label>월세 (원)</label><input id="e-rent" inputmode="numeric" value="${u.rent ? won(u.rent) : ""}"></div></div>
     <div class="field"><label>관리비 방식</label><select id="e-mode"><option ${u.maintMode === SAME ? "selected" : ""}>${SAME}</option><option ${u.maintMode === DIFF ? "selected" : ""}>${DIFF}</option></select></div>
     <div class="frow"><div class="field"><label id="lab-maint">관리비 (원)</label><input id="e-maint" inputmode="numeric" value="${u.maintenance ? won(u.maintenance) : ""}"></div>
       <div class="field" id="wrap-even"><label>관리비 · 짝수달 (원)</label><input id="e-even" inputmode="numeric" value="${u.maintEven ? won(u.maintEven) : ""}"></div></div>
     <div class="field"><label>메모</label><input id="e-memo" value="${esc(u.memo || "")}"></div>`,
    `<button id="c">취소</button><button id="s" class="accent">저장</button>`);
  ["e-deposit", "e-rent", "e-maint", "e-even"].forEach((id) => bindMoney(ov.querySelector("#" + id)));
  const status = ov.querySelector("#e-status"), mode = ov.querySelector("#e-mode");
  const lockFields = ["e-tenant", "e-tax", "e-bank", "e-start", "e-end", "e-deposit"];
  const applyStatus = () => { const occ = status.value === OCC; lockFields.forEach((id) => ov.querySelector("#" + id).disabled = !occ); };
  const applyMode = () => { const diff = mode.value === DIFF; ov.querySelector("#wrap-even").style.display = diff ? "" : "none"; ov.querySelector("#lab-maint").textContent = diff ? "관리비 · 홀수달 (원)" : "관리비 (원)"; };
  status.onchange = applyStatus; mode.onchange = applyMode; applyStatus(); applyMode();
  ov.querySelector("#c").onclick = () => ov.remove();
  ov.querySelector("#s").onclick = () => {
    u.status = status.value; u.tenant = ov.querySelector("#e-tenant").value.trim();
    u.taxDay = Math.min(Math.max(parseNum(ov.querySelector("#e-tax").value), 0), 31);
    u.bank = ov.querySelector("#e-bank").value.trim();
    u.startDate = isoOf(ov.querySelector("#e-start").value); u.endDate = isoOf(ov.querySelector("#e-end").value);
    u.deposit = parseNum(ov.querySelector("#e-deposit").value); u.rent = parseNum(ov.querySelector("#e-rent").value);
    u.maintMode = mode.value; u.maintenance = parseNum(ov.querySelector("#e-maint").value);
    u.maintEven = mode.value === DIFF ? parseNum(ov.querySelector("#e-even").value) : 0;
    u.memo = ov.querySelector("#e-memo").value.trim();
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
    data.moveOuts.unshift({ id: uid(), buildingName: b.name, floor: u.floor, unit: u.unit, tenant: u.tenant, bank: u.bank, taxDay: u.taxDay, startDate: u.startDate, endDate: u.endDate, deposit: u.deposit, rent: u.rent, maintenance: u.maintenance, maintMode: u.maintMode, maintEven: u.maintEven, totalDue: td, totalPaid: tp, unpaid: td - tp, moveOutDate: isoOf(ov.querySelector("#e-date").value), memo: ov.querySelector("#e-memo").value.trim(), archivedAt: isoOf(todayYmd()), payments: u.payments });
    Object.assign(u, { status: VAC, tenant: "", bank: "", taxDay: 0, startDate: null, endDate: null, deposit: 0, payments: [] });
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
    ov.querySelector("#adetail").innerHTML = `<b>${esc(m.buildingName)} ${esc([m.floor, m.unit].filter(Boolean).join(" "))}</b> · 임차인 ${esc(m.tenant)} · 은행 ${esc(m.bank || "—")}<br>계약 ${ymdOf(m.startDate)}~${ymdOf(m.endDate)} · 보증금 ${won(m.deposit)} · 월세 ${won(m.rent)}<br>총예정 ${won(m.totalDue)} / 총입금 ${won(m.totalPaid)} / 미납 ${won(m.unpaid)} · 메모 ${esc(m.memo || "—")}`;
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

// ===== CSV =====
function exportCSV() {
  const head = ["건물명", "층", "호실", "상태", "임차인", "입금은행", "세금계산서발행일", "계약시작일", "계약종료일", "보증금", "월세", "관리비방식", "관리비", "관리비짝수달", "입금월", "입금예정액", "실입금액", "실입금일", "당월미납", "메모"];
  const lines = [head];
  for (const b of data.buildings) for (const u of b.units) {
    const base = [b.name, u.floor, u.unit, u.status, u.tenant, u.bank || "", u.taxDay > 0 ? `매달 ${u.taxDay}일` : "", ymdOf(u.startDate), ymdOf(u.endDate), u.deposit, u.rent, u.maintMode, u.maintenance, u.maintEven];
    if (!u.payments.length) lines.push(base.concat(["", "", "", "", "", ""]));
    else for (const p of u.payments) lines.push(base.concat([p.period, p.due, p.paid, ymdOf(p.paidDate), (p.due || 0) - (p.paid || 0), p.memo || ""]));
  }
  const csv = lines.map((r) => r.map((f) => { const s = String(f ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
  window.api.exportCsv(csv, `RentDesk_${todayYmd()}.csv`);
}

// ===== 시작 =====
document.getElementById("btnAddBuilding").onclick = () => openBuildingEditor(null);
document.getElementById("btnAddUnit").onclick = openAddRoom;
document.getElementById("btnDelUnit").onclick = () => { const u = unit(); if (!u) return alert("호실을 선택하세요."); if (confirm(`「${[u.floor, u.unit].filter(Boolean).join(" ")}」 호실을 삭제할까요?`)) { building().units = building().units.filter((x) => x.id !== u.id); selUnitId = building().units[0]?.id || null; save(); renderAll(); } };
document.getElementById("btnMoveOut").onclick = openMoveOut;
document.getElementById("btnTax").onclick = openTaxMonth;
document.getElementById("btnArchive").onclick = openArchive;
document.getElementById("btnCsv").onclick = exportCSV;

load().then(renderAll);
