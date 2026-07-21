const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

app.setName("RentDesk");

function dataDir() {
  const dir = app.getPath("userData"); // .../RentDesk
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function dataFile() { return path.join(dataDir(), "data.json"); }
function attachmentsDir() {
  const dir = path.join(dataDir(), "attachments");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    title: "RentDesk",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// ---- 자동 업데이트 (GitHub Releases에서 새 버전 확인) ----
function setupAutoUpdate() {
  if (!app.isPackaged) return;   // 개발 실행 중에는 건너뜀
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;   // "나중에" 해도 앱 종료 시 자동 적용
  autoUpdater.on("update-downloaded", (info) => {
    dialog.showMessageBox({
      type: "info",
      buttons: ["지금 재시작", "나중에 (종료할 때 적용)"],
      defaultId: 0,
      message: "업데이트 준비 완료",
      detail: `새 버전(v${info.version})을 내려받았습니다.\n재시작하면 적용됩니다. 데이터는 그대로 유지됩니다.`,
    }).then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on("error", () => {});   // 오프라인 등은 조용히 무시
  autoUpdater.checkForUpdates().catch(() => {});
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdate();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

// ---- 데이터 ----
ipcMain.handle("load", () => {
  try { return fs.readFileSync(dataFile(), "utf8"); }
  catch { return null; }
});
ipcMain.handle("save", (_e, text) => {
  fs.writeFileSync(dataFile(), text, "utf8");
  return true;
});

// ---- 첨부 ----
ipcMain.handle("attach", async (_e, { unitId, kind }) => {
  const res = await dialog.showOpenDialog({
    title: "파일 선택",
    properties: ["openFile"],
    filters: [{ name: "이미지·PDF", extensions: ["png", "jpg", "jpeg", "heic", "pdf", "gif", "webp"] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const src = res.filePaths[0];
  const ext = path.extname(src) || ".dat";
  const dest = path.join(attachmentsDir(), `${unitId}_${kind}_${Date.now()}${ext}`);
  fs.copyFileSync(src, dest);
  return dest;
});
ipcMain.handle("openFile", (_e, p) => { if (p) shell.openPath(p); });
ipcMain.handle("removeFile", (_e, p) => { try { if (p) fs.unlinkSync(p); } catch {} });
ipcMain.handle("exportCsv", async (_e, { text, name }) => {
  const res = await dialog.showSaveDialog({ defaultPath: name, filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, "﻿" + text, "utf8");
  return true;
});
ipcMain.handle("saveAttachmentCopy", async (_e, srcPath) => {
  const res = await dialog.showSaveDialog({ defaultPath: path.basename(srcPath) });
  if (res.canceled || !res.filePath) return false;
  fs.copyFileSync(srcPath, res.filePath);
  return true;
});

// ---- 엑셀 내보내기 ----
ipcMain.handle("exportExcel", async (_e, { bytes, name }) => {
  const res = await dialog.showSaveDialog({ defaultPath: name, filters: [{ name: "Excel 통합 문서", extensions: ["xlsx"] }] });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, Buffer.from(bytes));
  shell.showItemInFolder(res.filePath);
  return true;
});

// ---- 백업 (다른 컴퓨터/OS로 이동) ----
// 데이터 + 첨부파일을 zip 하나로 백업. attachPaths = 원본 파일 경로 목록
ipcMain.handle("exportBackup", async (_e, { text, name, attachPaths }) => {
  const res = await dialog.showSaveDialog({ defaultPath: name, filters: [{ name: "RentDesk 백업", extensions: ["zip"] }] });
  if (res.canceled || !res.filePath) return false;
  const files = [{ name: "data.json", data: Buffer.from(text, "utf8") }];
  const seen = new Set();
  for (const p of attachPaths || []) {
    try {
      const base = path.basename(p);
      if (seen.has(base) || !fs.existsSync(p)) continue;
      files.push({ name: `attachments/${base}`, data: fs.readFileSync(p) });
      seen.add(base);
    } catch {}
  }
  fs.writeFileSync(res.filePath, zipStore(files));
  shell.showItemInFolder(res.filePath);
  return true;
});

// zip(또는 구버전 json) 백업을 읽어 { json, restored } 반환. 첨부는 보관 폴더로 복원
ipcMain.handle("importBackup", async () => {
  const res = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "RentDesk 백업", extensions: ["zip", "json"] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const raw = fs.readFileSync(res.filePaths[0]);

  // 구버전: 순수 JSON
  if (raw[0] === 0x7b /* { */) return { json: raw.toString("utf8"), restored: {} };

  const entries = zipExtract(raw);
  const jsonBuf = entries["data.json"];
  if (!jsonBuf) return null;
  const dir = attachmentsDir();
  const restored = {};
  for (const [name, buf] of Object.entries(entries)) {
    if (!name.startsWith("attachments/")) continue;
    const base = path.basename(name);
    const dest = path.join(dir, base);
    try { fs.writeFileSync(dest, buf); restored[base] = dest; } catch {}
  }
  return { json: jsonBuf.toString("utf8"), restored };
});

// ---- 무압축 ZIP 읽기/쓰기 ----
function zipStore(files) {
  const chunks = [], central = [];
  let offset = 0;
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data), size = f.data.length;
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBuf.length), u16(0), nameBuf, f.data]);
    chunks.push(local);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBuf]));
    offset += local.length;
  }
  const cen = Buffer.concat(central);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cen.length), u32(offset), u16(0)]);
  return Buffer.concat([...chunks, cen, end]);
}

function zipExtract(buf) {
  const out = {};
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const dataStart = nameStart + nameLen + extraLen;
    if (dataStart + compSize > buf.length) break;
    const name = buf.slice(nameStart, nameStart + nameLen).toString("utf8");
    if (method === 0) out[name] = buf.slice(dataStart, dataStart + compSize);
    i = dataStart + compSize;
  }
  return out;
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
