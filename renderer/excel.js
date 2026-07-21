"use strict";

// 세무사 제출용 엑셀(.xlsx) 생성 — 외부 라이브러리 없이 zip+xml을 직접 만든다. (맥판과 동일 양식)
// 시트1 "임대현황": 건물별 표, 공실은 병합 행
// 시트2 "입금내역": 선택한 분기 3개월치

// 스타일 인덱스 (styles.xml cellXfs 순서와 일치)
const XS = { normal: 0, title: 1, header: 2, textC: 3, money: 4, vacant: 5, buildingHdr: 6, dateC: 7 };

function colLetter(n) {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function xesc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const T = (t, style = XS.textC) => ({ t: "s", v: t, s: style });
const N = (v, style = XS.money) => ({ t: "n", v: Number(v) || 0, s: style });
const E = (style = XS.normal) => ({ t: "e", s: style });

function quarterMonths(year, q) {
  const start = (q - 1) * 3 + 1;
  return [0, 1, 2].map((i) => `${year}-${String(start + i).padStart(2, "0")}`);
}

function manwon(v) {
  if (!v) return "0";
  return v % 10000 === 0 ? `${v / 10000}만원` : won(v) + "원";
}
function floorSortKey(f) {
  const n = parseInt(String(f).replace(/[^0-9]/g, ""), 10) || 0;
  return String(f).includes("지하") || /^b/i.test(String(f)) ? -n : n;
}
function sortedUnitsOf(b) {
  return [...b.units].sort((a, c) => floorSortKey(a.floor) - floorSortKey(c.floor) || (a.unit || "").localeCompare(c.unit || ""));
}
const roomName = (u) => [u.floor, u.unit].filter(Boolean).join(" ") || "(호실)";

// ---- 시트1: 임대현황 ----
function buildStatusSheet(data, year, quarter, companyName) {
  const rows = [], merges = [];
  const widths = [[1, 16], [2, 20], [3, 12], [4, 16], [5, 16], [6, 18], [7, 16], [8, 14], [9, 14], [10, 14], [11, 14], [12, 16], [13, 14], [14, 12]];
  const colCount = 14;

  rows.push({ cells: [] });
  const titleRow = Array.from({ length: colCount }, () => E(XS.title));
  titleRow[0] = T(`${companyName} ${year}년 ${quarter}분기 임대현황`, XS.title);
  rows.push({ cells: titleRow, height: 34 });
  merges.push(`A2:${colLetter(colCount)}2`);
  rows.push({ cells: [] });

  for (const b of data.buildings) {
    const headers = [b.name, "상호", "대표자", "연락처", "세금계산서 발행일", "사업자등록번호",
      "보증금", "월세(원)", "월세 부가세(원)", "관리비(원)", "부가세(원)", "합계", "공용요금", "비고"];
    rows.push({ cells: headers.map((t, i) => T(t, i === 0 ? XS.buildingHdr : XS.header)) });

    for (const u of sortedUnitsOf(b)) {
      const rowIndex = rows.length + 1;
      if (u.status === VAC) {
        const cells = Array.from({ length: colCount }, () => E(XS.vacant));
        cells[0] = T(roomName(u), XS.textC);
        cells[1] = T("공실", XS.vacant);
        cells[colCount - 1] = E(XS.textC);
        rows.push({ cells });
        merges.push(`B${rowIndex}:${colLetter(colCount - 1)}${rowIndex}`);
      } else {
        const total = withVAT(u.rent || 0) + withVAT(u.maintenance || 0);
        const commonTxt = hasCommon(u) ? `${manwon(u.commonOdd || 0)}/${manwon(u.commonEven || 0)}` : "";
        rows.push({ cells: [
          T(roomName(u)), T(u.tenant || ""), T(u.owner || ""), T(u.phone || ""),
          T(u.taxDay > 0 ? `${u.taxDay}일` : "", XS.dateC), T(u.bizNo || ""),
          N(u.deposit), N(u.rent), N(vatOnly(u.rent || 0)),
          N(u.maintenance), N(vatOnly(u.maintenance || 0)), N(total),
          T(commonTxt), E(XS.textC),
        ]});
      }
    }
    rows.push({ cells: [] });
  }
  return { rows, merges, widths };
}

// ---- 시트2: 입금내역 ----
function buildPaymentSheet(data, months) {
  const rows = [], merges = [];
  const widths = [[1, 18], [2, 14], [3, 20], [4, 18], [5, 12], [6, 16], [7, 16], [8, 14], [9, 14], [10, 14], [11, 20]];
  const colCount = 11;

  const titleRow = Array.from({ length: colCount }, () => E(XS.title));
  titleRow[0] = T(`입금내역 (${months[0]} ~ ${months[months.length - 1]})`, XS.title);
  rows.push({ cells: titleRow, height: 30 });
  merges.push(`A1:${colLetter(colCount)}1`);
  rows.push({ cells: [] });

  const headers = ["건물", "호실", "임차인", "사업자등록번호", "입금월", "입금예정액", "실입금액", "실입금일", "당월미납", "누적미납", "메모"];
  rows.push({ cells: headers.map((t) => T(t, XS.header)) });

  const monthSet = new Set(months);
  for (const b of data.buildings) {
    for (const u of sortedUnitsOf(b)) {
      let running = 0;
      for (const p of u.payments || []) {
        running += (p.due || 0) - (p.paid || 0);
        if (!monthSet.has(p.period)) continue;
        const tu = (p.due || 0) - (p.paid || 0);
        const d = ymdOf(p.paidDate);
        rows.push({ cells: [
          T(b.name), T(roomName(u)), T(u.tenant || ""), T(u.bizNo || ""), T(p.period),
          N(p.due), N(p.paid), T(d || "", XS.dateC),
          tu === 0 ? E(XS.money) : N(tu),
          running === 0 ? E(XS.money) : N(running),
          T(p.memo || ""),
        ]});
      }
    }
  }
  return { rows, merges, widths };
}

// ---- xlsx 조립 ----
function sheetXML(rows, merges, widths) {
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`;
  if (widths.length) {
    xml += "<cols>";
    for (const [i, w] of widths) xml += `<col min="${i}" max="${i}" width="${w}" customWidth="1"/>`;
    xml += "</cols>";
  }
  xml += "<sheetData>";
  rows.forEach((row, ri) => {
    const r = ri + 1;
    const h = row.height ? ` ht="${row.height}" customHeight="1"` : "";
    if (!row.cells.length) { xml += `<row r="${r}"${h}/>`; return; }
    xml += `<row r="${r}"${h}>`;
    row.cells.forEach((c, ci) => {
      const ref = `${colLetter(ci + 1)}${r}`;
      if (c.t === "s" && c.v) xml += `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${xesc(c.v)}</t></is></c>`;
      else if (c.t === "n") xml += `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>`;
      else xml += `<c r="${ref}" s="${c.s}"/>`;
    });
    xml += "</row>";
  });
  xml += "</sheetData>";
  if (merges.length) {
    xml += `<mergeCells count="${merges.length}">`;
    for (const m of merges) xml += `<mergeCell ref="${m}"/>`;
    xml += "</mergeCells>";
  }
  return xml + "</worksheet>";
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;₩&quot;#,##0"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="맑은 고딕"/></font>
<font><sz val="20"/><b/><name val="맑은 고딕"/></font>
<font><sz val="11"/><b/><name val="맑은 고딕"/></font>
<font><sz val="11"/><color rgb="FF808080"/><name val="맑은 고딕"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/// 엑셀 파일(바이트 배열) 생성 — main 프로세스로 넘겨 저장
function buildExcel(data, year, quarter, companyName) {
  const months = quarterMonths(year, quarter);
  const s1 = buildStatusSheet(data, year, quarter, companyName);
  const s2 = buildPaymentSheet(data, months);
  const sheets = [{ name: "임대현황", ...s1 }, { name: "입금내역", ...s2 }];

  const files = [];
  const enc = new TextEncoder();
  files.push(["[Content_Types].xml", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`)]);
  files.push(["_rels/.rels", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`)]);
  files.push(["xl/workbook.xml", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`)]);
  files.push(["xl/_rels/workbook.xml.rels", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`)]);
  files.push(["xl/styles.xml", enc.encode(STYLES_XML)]);
  sheets.forEach((s, i) => {
    files.push([`xl/worksheets/sheet${i + 1}.xml`, enc.encode(sheetXML(s.rows, s.merges, s.widths))]);
  });

  return zipStore(files);
}

// ---- 무압축 ZIP ----
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {
  const chunks = [], central = [];
  let offset = 0;
  const enc = new TextEncoder();
  const u16 = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; };

  for (const [name, content] of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(content), size = content.length;
    const local = [u32(0x04034B50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), nameBytes, content];
    const localLen = local.reduce((s, a) => s + a.length, 0);
    chunks.push(...local);
    central.push(u32(0x02014B50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBytes);
    offset += localLen;
  }
  const centralLen = central.reduce((s, a) => s + a.length, 0);
  const end = [u32(0x06054B50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralLen), u32(offset), u16(0)];

  const all = [...chunks, ...central, ...end];
  const total = all.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of all) { out.set(a, pos); pos += a.length; }
  return out;
}
