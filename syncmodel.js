// 동기화 공통 논리 — 네트워크·Firebase와 무관한 순수 계산만 둔다(그래서 따로 시험하기 쉽다).
//
// 왜 이런 구조인가:
//   앱의 자료는 건물 > 호실 > 입금내역으로 겹쳐진 하나의 덩어리(data.json)다. 이걸 통째로
//   주고받으면 두 사람이 서로 다른 호실을 고쳐도 한쪽 작업이 덮여 사라진다. 그래서 올릴 때는
//   레코드(건물 하나, 호실 하나, 입금 한 줄) 단위로 쪼개고, 바뀐 것만 보낸다.
//
//   삭제는 '지웠다는 표시'(deletedAt)를 남긴다. 그냥 빼버리면 다른 컴퓨터가 그 레코드를
//   "내게만 있는 것"으로 보고 다시 올려서 되살아난다.
//
//   날짜는 양쪽 앱(맥 Swift / 윈도우 Electron)이 같은 형식으로 읽도록 ISO 문자열로 보관한다.
//   Firestore의 Timestamp 타입은 쓰지 않는다.

const COLS = ["buildings", "units", "payments", "taxIssued", "moveOuts"];

// 호실 레코드에 담는 칸 — payments(입금내역)는 따로 떼어 별도 레코드로 보낸다.
const UNIT_FIELDS = [
  "floor", "unit", "status", "tenant", "owner", "phone", "bizNo", "taxDay", "bank",
  "startDate", "endDate", "deposit", "rent", "maintMode", "maintenance", "maintEven",
  "commonOdd", "commonEven", "mergedInto", "memo", "businessCert", "contract",
];
const PAYMENT_FIELDS = ["period", "due", "paid", "paidDate", "memo", "isOpening"];
const BUILDING_FIELDS = ["name", "address", "memo"];
const MOVEOUT_FIELDS = [
  "buildingName", "floor", "unit", "tenant", "owner", "phone", "bizNo", "bank", "taxDay",
  "startDate", "endDate", "deposit", "rent", "maintenance", "maintEven", "commonOdd",
  "commonEven", "memo", "businessCert", "contract", "movedOutAt", "payments",
];

function pick(src, fields) {
  const out = {};
  for (const f of fields) if (src[f] !== undefined) out[f] = src[f];
  return out;
}

// 세금계산서 발행 기록은 자체 id가 없어서 "호실id|입금월"을 id로 삼는다.
const taxId = (t) => `${t.unitID}|${t.period}`;

/// 겹쳐진 자료(data)를 레코드 목록으로 펼친다. order는 화면에 보이는 순서(드래그 정렬 보존용).
function flatten(data) {
  const out = { buildings: {}, units: {}, payments: {}, taxIssued: {}, moveOuts: {} };
  (data.buildings || []).forEach((b, bi) => {
    out.buildings[b.id] = { id: b.id, order: bi, ...pick(b, BUILDING_FIELDS) };
    (b.units || []).forEach((u, ui) => {
      out.units[u.id] = { id: u.id, buildingId: b.id, order: ui, ...pick(u, UNIT_FIELDS) };
      (u.payments || []).forEach((p, pi) => {
        out.payments[p.id] = { id: p.id, unitId: u.id, order: pi, ...pick(p, PAYMENT_FIELDS) };
      });
    });
  });
  (data.taxIssued || []).forEach((t) => {
    out.taxIssued[taxId(t)] = { id: taxId(t), unitID: t.unitID, period: t.period, issuedAt: t.issuedAt };
  });
  (data.moveOuts || []).forEach((m, i) => {
    out.moveOuts[m.id] = { id: m.id, order: i, ...pick(m, MOVEOUT_FIELDS) };
  });
  return out;
}

/// 비교용 문자열 — 칸 이름을 정렬해서 만든다. 저장소에서 내려온 레코드는 칸 순서가
/// 제각각이라 그냥 비교하면 내용이 같아도 다르다고 나온다.
/// updatedAt(올린 시각)과 order 외의 관리용 칸은 '내용'이 아니므로 비교에서 뺀다.
function canon(rec) {
  const out = {};
  for (const k of Object.keys(rec).sort()) {
    if (k === "updatedAt") continue;
    if (rec[k] !== undefined) out[k] = rec[k];
  }
  return JSON.stringify(out);
}

/// 두 레코드가 내용상 같은지 — 올릴 필요가 있는지 판단할 때만 쓴다.
function sameRecord(a, b) {
  if (!a || !b) return false;
  return canon(a) === canon(b);
}

/// 마지막으로 맞춰둔 사본(shadow)과 지금 자료를 비교해, 올려야 할 레코드만 추린다.
/// 반환: [{ col, id, doc }] — doc에 deletedAt이 있으면 삭제 표시다.
function changes(shadow, current, now = Date.now()) {
  const out = [];
  for (const col of COLS) {
    const before = (shadow && shadow[col]) || {};
    const after = current[col] || {};
    for (const id of Object.keys(after)) {
      if (!sameRecord(before[id], after[id])) out.push({ col, id, doc: { ...after[id], updatedAt: now } });
    }
    for (const id of Object.keys(before)) {
      // 이미 삭제 표시로 올린 것은 다시 올리지 않는다
      if (!after[id] && !before[id].deletedAt) {
        out.push({ col, id, doc: { id, deletedAt: now, updatedAt: now } });
      }
    }
  }
  return out;
}

/// 내려온 레코드를 반영한다. 같은 레코드가 양쪽에서 바뀌었으면 updatedAt이 큰 쪽을 남긴다.
/// shadow(마지막으로 맞춰둔 사본)를 갱신해서 돌려준다 — 이 결과로 다시 트리를 세운다.
function mergeRemote(shadow, remote) {
  const next = {};
  for (const col of COLS) next[col] = { ...((shadow && shadow[col]) || {}) };
  for (const { col, id, doc } of remote) {
    if (!COLS.includes(col)) continue;
    const mine = next[col][id];
    if (mine && (mine.updatedAt || 0) > (doc.updatedAt || 0)) continue;  // 내 것이 더 최신
    next[col][id] = doc;
  }
  return next;
}

/// 레코드 목록을 다시 겹쳐진 자료(data.json 형태)로 세운다. 삭제 표시된 것은 빼고 세운다.
function rebuild(records) {
  const live = (col) => Object.values(records[col] || {}).filter((r) => !r.deletedAt);
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

  const paymentsOf = {};
  for (const p of live("payments").sort(byOrder)) {
    (paymentsOf[p.unitId] ||= []).push({ id: p.id, ...pick(p, PAYMENT_FIELDS) });
  }
  const unitsOf = {};
  for (const u of live("units").sort(byOrder)) {
    const unit = { id: u.id, ...pick(u, UNIT_FIELDS), payments: paymentsOf[u.id] || [] };
    (unitsOf[u.buildingId] ||= []).push(unit);
  }
  return {
    buildings: live("buildings").sort(byOrder).map((b) => ({
      id: b.id, ...pick(b, BUILDING_FIELDS), units: unitsOf[b.id] || [],
    })),
    moveOuts: live("moveOuts").sort(byOrder).map((m) => ({ id: m.id, ...pick(m, MOVEOUT_FIELDS) })),
    taxIssued: live("taxIssued").map((t) => ({ unitID: t.unitID, period: t.period, issuedAt: t.issuedAt })),
  };
}

module.exports = { COLS, flatten, changes, mergeRemote, rebuild, sameRecord, taxId };
