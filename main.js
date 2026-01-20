// main.js - Electron Main Process (Aura Gaming PC Optimizer - Patched)
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const fsSync = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// System info
const si = require('systeminformation');

// ---------------- Firebase (lazy ESM loader) ----------------
let FB = null;
async function ensureFirebase() {
  if (FB) return FB;
  const { initializeApp } = await import('firebase/app');
  const fstore = await import('firebase/firestore');

  const firebaseConfig = {
    apiKey: "AIzaSyCx62ICCDFVoskUgyHdo3r8XZYECASDgQ4",
    authDomain: "aura-opt-admin.firebaseapp.com",
    projectId: "aura-opt-admin",
    storageBucket: "aura-opt-admin.firebasestorage.app",
    messagingSenderId: "622881381421",
    appId: "1:622881381421:web:8807807c058754fc062ca4"
  };

  const fbApp = initializeApp(firebaseConfig);
  const {
    getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, updateDoc
  } = fstore;

  FB = {
    db: getFirestore(fbApp),
    doc, getDoc, setDoc, collection, query, where, getDocs, updateDoc,
  };
  return FB;
}
// ------------------------------------------------------------

// Paths
let SETTINGS_PATH = null;
let LOG_PATH = null;
let DEBUG_LOG_PATH = null;
let REPORT_PATH = null;
let RESTORE_POINTS_PATH = null;

// App State
const appState = {
  window: null,
  isActivated: false,
  isOptimizerEnabled: true,
  debugMode: false,
  hwid: null,
  lastOptimization: null,
  lastRamFreedGB: 0,
  lastJunkCleanedGB: 0,
  options: {
    gameMode: true,
    backgroundProcessTrim: true,
    diskCleanup: true,
    browserCacheCleanup: true,
    recycleBinEmpty: true,
    windowsUpdateCacheCleanup: false,
    logsCleanup: true,
    memoryCompression: false,
    storageOptimize: true,
    dnsSwitch: false,
    tcpTune: false,
    gpuVisualTuning: true,
    hardwareGpuScheduling: false,
    nvapi: false,
    startupItems: false
  }
};

// Helpers
function isWindows() { return process.platform === 'win32'; }
function bytesToGB(bytes) { return Math.max(0, (bytes || 0) / (1024 ** 3)); }

function ensurePaths() {
  if (!SETTINGS_PATH) {
    const userData = app.getPath('userData');
    SETTINGS_PATH = path.join(userData, 'aura_settings.json');
    LOG_PATH = path.join(userData, 'aura.log');
    DEBUG_LOG_PATH = path.join(userData, 'debug.log');
    REPORT_PATH = path.join(userData, 'optimization_report.json');
    RESTORE_POINTS_PATH = path.join(userData, 'restore_points.json');
  }
}

function sendToRenderer(channel, payload) {
  if (appState.window && !appState.window.isDestroyed()) {
    appState.window.webContents.send(channel, payload);
  }
}

function logLine(message, isDebug = false) {
  try {
    ensurePaths();
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    const targetPath = isDebug ? DEBUG_LOG_PATH : LOG_PATH;
    fsSync.appendFileSync(targetPath, line);
  } catch (error) {
    console.error('Logging error:', error);
  }
}

async function loadSettings() {
  ensurePaths();
  try {
    const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(data);
    if (settings.options) appState.options = { ...appState.options, ...settings.options };
    if (typeof settings.isOptimizerEnabled === 'boolean') appState.isOptimizerEnabled = settings.isOptimizerEnabled;
    if (typeof settings.debugMode === 'boolean') appState.debugMode = settings.debugMode;
    if (settings.lastOptimization) appState.lastOptimization = settings.lastOptimization;
    if (typeof settings.lastRamFreedGB === 'number') appState.lastRamFreedGB = settings.lastRamFreedGB;
    if (typeof settings.lastJunkCleanedGB === 'number') appState.lastJunkCleanedGB = settings.lastJunkCleanedGB;
  } catch {
    logLine('First run - creating default settings');
  }
}

async function saveSettings() {
  ensurePaths();
  const settings = {
    options: appState.options,
    isOptimizerEnabled: appState.isOptimizerEnabled,
    debugMode: appState.debugMode,
    lastOptimization: appState.lastOptimization,
    lastRamFreedGB: appState.lastRamFreedGB,
    lastJunkCleanedGB: appState.lastJunkCleanedGB
  };
  try {
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (error) {
    logLine(`Failed to save settings: ${error.message}`);
  }
}

// HWID
async function getStableHWID() {
  if (appState.hwid) return appState.hwid;
  try {
    const baseboard = await si.baseboard();
    const system = await si.system();
    const cpu = await si.cpu();
    const components = [
      baseboard.serial || 'unknown',
      system.uuid || 'unknown',
      cpu.brand || 'unknown',
      os.hostname(),
      os.userInfo().username
    ];
    const combined = components.join('|');
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    appState.hwid = hash.substring(0, 32).toUpperCase();
    return appState.hwid;
  } catch (error) {
    logLine(`HWID generation error: ${error.message}`);
    const fallback = `${os.hostname()}_${os.userInfo().username}`;
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(fallback).digest('hex');
    appState.hwid = hash.substring(0, 32).toUpperCase();
    return appState.hwid;
  }
}

// Window
async function createWindow() {
  appState.window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    resizable: true,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: true
  });

  await appState.window.loadFile(path.join(__dirname, 'index.html'));

  appState.window.once('ready-to-show', () => {
    appState.window.show();
  });

  if (appState.debugMode) {
    appState.window.webContents.openDevTools();
  }
}

// License IPC
ipcMain.handle('get-hwid', async () => {
  try {
    const hwid = await getStableHWID();
    return { ok: true, hwid };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('activate-license', async (_e, { key, hwid }) => {
  try {
    const f = await ensureFirebase();
    logLine(`License activation attempt for key: ${String(key).substring(0, 8)}...`);
    const docRef = f.doc(f.db, 'license_keys', key);
    const snap = await f.getDoc(docRef);
    if (!snap.exists()) {
      sendToRenderer('optimization-complete', { ok: false, error: 'Invalid license key' });
      return { ok: false, error: 'Invalid license key' };
    }
    const data = snap.data();
    if (data.isUsed && data.usedByHwid && data.usedByHwid !== hwid) {
      const msg = 'License key is already in use on another device';
      sendToRenderer('optimization-complete', { ok: false, error: msg });
      return { ok: false, error: msg };
    }
    await f.setDoc(docRef, {
      ...data,
      isUsed: true,
      usedByHwid: hwid,
      activatedAt: new Date().toISOString()
    }, { merge: true });

    appState.isActivated = true;
    await saveSettings();
    logLine('License activated successfully');
    return { ok: true };
  } catch (error) {
    logLine(`License activation failed: ${error.message}`);
    sendToRenderer('optimization-complete', { ok: false, error: error.message });
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('logout', async () => {
  try {
    const f = await ensureFirebase();
    const hwid = await getStableHWID();
    const qy = f.query(
      f.collection(f.db, 'license_keys'),
      f.where('usedByHwid', '==', hwid),
      f.where('isUsed', '==', true)
    );
    const qs = await f.getDocs(qy);
    for (const d of qs.docs) {
      await f.updateDoc(d.ref, { isUsed: false, usedByHwid: null });
    }
    appState.isActivated = false;
    await saveSettings();
    logLine('License deactivated successfully');
    return { ok: true };
  } catch (error) {
    logLine(`License deactivation failed: ${error.message}`);
    return { ok: false, error: error.message };
  }
});

// Auto-activation on startup
async function checkActivationOnLaunch() {
  try {
    const f = await ensureFirebase();
    const hwid = await getStableHWID();
    const qy = f.query(
      f.collection(f.db, 'license_keys'),
      f.where('usedByHwid', '==', hwid),
      f.where('isUsed', '==', true)
    );
    const qs = await f.getDocs(qy);
    appState.isActivated = !qs.empty;
    if (appState.isActivated) logLine('Auto-activation successful');
  } catch (error) {
    logLine(`Auto-activation check failed: ${error.message}`);
    appState.isActivated = false;
  }
}

// System Stats
ipcMain.handle('get-system-stats', async () => {
  try {
    const mem = await si.mem();
    const graphics = await si.graphics();
    const osInfo = await si.osInfo();
    const cpu = await si.cpu();
    let latencyMs = null;
    if (isWindows()) {
      try {
        const { stdout } = await execAsync('ping -n 1 8.8.8.8', { timeout: 5000, windowsHide: true });
        const match = stdout.match(/Average = (\d+)ms/i);
        if (match) latencyMs = parseInt(match[1], 10);
      } catch (error) {
        logLine(`Latency check failed: ${error.message}`, true);
      }
    }
    const gpuModel = graphics.controllers[0]?.model || 'Unknown GPU';
    return {
      isActivated: appState.isActivated,
      isOptimizerEnabled: appState.isOptimizerEnabled,
      lastOptimization: appState.lastOptimization,
      totalRamGB: bytesToGB(mem.total).toFixed(2),
      usedRamGB: bytesToGB(mem.active || mem.used).toFixed(2),
      freeRamGB: bytesToGB(mem.available || (mem.total - mem.used)).toFixed(2),
      ramFreed: appState.lastRamFreedGB.toFixed(2),
      junkCleaned: appState.lastJunkCleanedGB.toFixed(2),
      latencyMs,
      gpuModel,
      osVersion: `${osInfo.distro} ${osInfo.release}`,
      cpuModel: cpu.brand,
      appVersion: app.getVersion(),
      appMemoryUsage: { heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) }
    };
  } catch (error) {
    logLine(`Get system stats error: ${error.message}`);
    return { error: error.message };
  }
});

// Options
ipcMain.handle('get-options', async () => ({ ...appState.options }));

ipcMain.handle('set-options', async (_e, newOptions) => {
  appState.options = { ...appState.options, ...newOptions };
  await saveSettings();
  return { ok: true, options: appState.options };
});

ipcMain.handle('toggle-optimizer', async (_e, enabled) => {
  appState.isOptimizerEnabled = !!enabled;
  await saveSettings();
  return { ok: true, isEnabled: appState.isOptimizerEnabled };
});

ipcMain.handle('toggle-debug-mode', async (_e, enabled) => {
  appState.debugMode = !!enabled;
  await saveSettings();
  if (appState.window && appState.debugMode) {
    appState.window.webContents.openDevTools({ mode: 'detach' });
  }
  return { ok: true, debugMode: appState.debugMode };
});

// Window controls (renderer sends these)
ipcMain.on('window-minimize', () => {
  const w = BrowserWindow.getFocusedWindow(); if (w) w.minimize();
});
ipcMain.on('window-maximize', () => {
  const w = BrowserWindow.getFocusedWindow(); if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
});
ipcMain.on('window-close', () => {
  const w = BrowserWindow.getFocusedWindow(); if (w) w.close();
});

// Shell exec
async function safeExec(command, options = {}) {
  if (!isWindows()) return { ok: false, error: 'Windows-only operation' };
  try {
    const { stdout, stderr } = await execAsync(command, {
      windowsHide: true,
      timeout: 30000,
      ...options
    });
    return { ok: true, stdout: stdout || '', stderr: stderr || '' };
  } catch (error) {
    logLine(`Command failed: ${command} - ${error.message}`, true);
    return {
      ok: false,
      error: error.message,
      stdout: error.stdout || '',
      stderr: error.stderr || ''
    };
  }
}

// FS helpers
function calculateFolderSize(folderPath) {
  let totalSize = 0;
  const walk = (p) => {
    try {
      const stats = fsSync.statSync(p);
      if (stats.isFile()) totalSize += stats.size;
      else if (stats.isDirectory()) {
        for (const item of fsSync.readdirSync(p)) walk(path.join(p, item));
      }
    } catch { /* ignore */ }
  };
  try { walk(folderPath); } catch (e) { logLine(`Folder size calc error: ${e.message}`, true); }
  return totalSize;
}

async function deleteFolderContents(folderPath) {
  try {
    if (!fsSync.existsSync(folderPath)) return 0;
    const beforeSize = calculateFolderSize(folderPath);
    const items = await fs.readdir(folderPath);
    for (const item of items) {
      const itemPath = path.join(folderPath, item);
      try {
        const stat = await fs.stat(itemPath);
        if (stat.isDirectory()) {
          await fs.rm(itemPath, { recursive: true, force: true });
        } else {
          await fs.unlink(itemPath);
        }
      } catch { /* continue */ }
    }
    const afterSize = calculateFolderSize(folderPath);
    return beforeSize - afterSize;
  } catch (error) {
    logLine(`Delete folder contents error: ${error.message}`, true);
    return 0;
  }
}

// Optimization steps
async function enableGameMode() {
  if (!isWindows()) return { ok: false };
  const commands = [
    'reg add "HKCU\\Software\\Microsoft\\GameBar" /v AutoGameModeEnabled /t REG_DWORD /d 1 /f',
    'reg add "HKCU\\Software\\Microsoft\\GameBar" /v AllowAutoGameMode /t REG_DWORD /d 1 /f',
    'reg add "HKCU\\System\\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 0 /f'
  ];
  for (const cmd of commands) await safeExec(cmd);
  return { ok: true };
}

async function killBackgroundProcesses() {
  if (!isWindows()) return { ok: false };
  const processes = [
    'OneDrive.exe','Teams.exe','steam.exe','EpicGamesLauncher.exe','Discord.exe',
    'Spotify.exe','chrome.exe','firefox.exe'
  ];
  let killedCount = 0;
  for (const p of processes) {
    const res = await safeExec(`taskkill /IM "${p}" /F 2>nul`);
    if (res.ok) { killedCount++; logLine(`Killed process: ${p}`, true); }
  }
  return { ok: true, killedCount };
}

async function cleanTempFiles() {
  if (!isWindows()) return { ok: false, cleanedGB: 0 };
  const tempPaths = [
    process.env.TEMP,
    process.env.TMP,
    path.join(process.env.WINDIR || 'C:\\Windows', 'Temp'),
    path.join(process.env.LOCALAPPDATA || '', 'Temp')
  ].filter(Boolean);
  let total = 0;
  for (const p of tempPaths) if (fsSync.existsSync(p)) total += await deleteFolderContents(p);
  return { ok: true, cleanedGB: bytesToGB(total) };
}

async function cleanBrowserCaches() {
  if (!isWindows()) return { ok: false, cleanedGB: 0 };
  const localAppData = process.env.LOCALAPPDATA || '';
  const cachePaths = [
    path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
    path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
    path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
    path.join(localAppData, 'Mozilla', 'Firefox', 'Profiles'),
    path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Cache')
  ];
  let total = 0;
  for (const p of cachePaths) {
    if (!fsSync.existsSync(p)) continue;
    if (p.includes('Firefox')) {
      try {
        const profiles = await fs.readdir(p);
        for (const prof of profiles) {
          const profileCachePath = path.join(p, prof, 'cache2');
          if (fsSync.existsSync(profileCachePath)) total += await deleteFolderContents(profileCachePath);
        }
      } catch (e) { logLine(`Firefox cache cleanup error: ${e.message}`, true); }
    } else {
      total += await deleteFolderContents(p);
    }
  }
  return { ok: true, cleanedGB: bytesToGB(total) };
}

async function emptyRecycleBin() {
  if (!isWindows()) return { ok: false };
  const r = await safeExec('PowerShell.exe -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"');
  return { ok: r.ok };
}

async function cleanWindowsUpdateCache() {
  if (!isWindows()) return { ok: false, cleanedGB: 0 };
  const updateCachePath = path.join(process.env.WINDIR || 'C:\\Windows', 'SoftwareDistribution', 'Download');
  await safeExec('net stop wuauserv');
  let total = 0;
  if (fsSync.existsSync(updateCachePath)) total = await deleteFolderContents(updateCachePath);
  await safeExec('net start wuauserv');
  return { ok: true, cleanedGB: bytesToGB(total) };
}

async function cleanSystemLogs() {
  if (!isWindows()) return { ok: false, cleanedGB: 0 };
  const logPaths = [
    path.join(process.env.WINDIR || 'C:\\Windows', 'Logs'),
    path.join(process.env.LOCALAPPDATA || '', 'CrashDumps'),
    path.join(process.env.WINDIR || 'C:\\Windows', 'Minidump')
  ];
  let total = 0;
  for (const p of logPaths) if (fsSync.existsSync(p)) total += await deleteFolderContents(p);
  return { ok: true, cleanedGB: bytesToGB(total) };
}

async function optimizeMemory() {
  if (!isWindows()) return { ok: false };
  const commands = [
    'PowerShell.exe -Command "Enable-MMAgent -MemoryCompression"',
    'PowerShell.exe -Command "[System.GC]::Collect()"'
  ];
  for (const cmd of commands) await safeExec(cmd);
  return { ok: true };
}

async function optimizeStorage() {
  if (!isWindows()) return { ok: false };
  const commands = [
    'PowerShell.exe -Command "Optimize-Volume -DriveLetter C -ReTrim -ErrorAction SilentlyContinue"',
    'defrag C: /O'
  ];
  for (const cmd of commands) {
    const timeout = cmd.startsWith('defrag') ? 300000 : 60000;
    await safeExec(cmd, { timeout });
  }
  return { ok: true };
}

async function optimizeDNS() {
  if (!isWindows()) return { ok: false };
  const commands = [
    'ipconfig /flushdns',
    'PowerShell.exe -Command "Set-DnsClientServerAddress -InterfaceAlias \\"Wi-Fi\\" -ServerAddresses \\"1.1.1.1\\",\\"8.8.8.8\\""',
    'PowerShell.exe -Command "Set-DnsClientServerAddress -InterfaceAlias \\"Ethernet\\" -ServerAddresses \\"1.1.1.1\\",\\"8.8.8.8\\""'
  ];
  for (const cmd of commands) await safeExec(cmd);
  return { ok: true };
}

async function optimizeTCP() {
  if (!isWindows()) return { ok: false };
  const commands = [
    'netsh int tcp set global autotuninglevel=normal',
    'netsh int tcp set global rss=enabled',
    'netsh int tcp set global ecncapability=disabled'
  ];
  for (const cmd of commands) await safeExec(cmd);
  return { ok: true };
}

async function optimizeVisualEffects() {
  if (!isWindows()) return { ok: false };
  const commands = [
    'reg add "HKCU\\Control Panel\\Desktop" /v UserPreferencesMask /t REG_BINARY /d 9012038010000000 /f',
    'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v EnableTransparency /t REG_DWORD /d 0 /f',
    'reg add "HKCU\\Control Panel\\Desktop\\WindowMetrics" /v MinAnimate /t REG_SZ /d 0 /f'
  ];
  for (const cmd of commands) await safeExec(cmd);
  return { ok: true };
}

async function enableHardwareGPUScheduling() {
  if (!isWindows()) return { ok: false };
  const result = await safeExec('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v HwSchMode /t REG_DWORD /d 2 /f');
  return { ok: result.ok };
}

async function optimizeNVIDIA() {
  if (!isWindows()) return { ok: false };
  try {
    const graphics = await si.graphics();
    const hasNVIDIA = graphics.controllers.some(gpu =>
      gpu.vendor && gpu.vendor.toLowerCase().includes('nvidia')
    );
    if (!hasNVIDIA) return { ok: false, error: 'NVIDIA GPU not detected' };
    const commands = [
      'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v PowerMizerEnable /t REG_DWORD /d 1 /f',
      'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v PowerMizerLevel /t REG_DWORD /d 1 /f'
    ];
    for (const cmd of commands) await safeExec(cmd);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// Progress emitter
function emitProgress(i, stepsLen, stepName) {
  const progress = Math.round((i / stepsLen) * 100);
  sendToRenderer('optimization-progress', {
    stepIndex: i,
    stepName,
    step: stepName,
    progress,
    totalSteps: stepsLen
  });
}

// Main Optimization
ipcMain.handle('perform-optimization', async (_e, options = {}) => {
  const earlyFail = (msg) => {
    sendToRenderer('optimization-complete', { ok: false, error: msg });
    return { ok: false, error: msg };
  };
  if (!appState.isActivated) return earlyFail('License activation required');
  if (!appState.isOptimizerEnabled) return earlyFail('Optimizer is disabled');
  if (!isWindows()) return earlyFail('Windows-only optimization');

  logLine('Starting system optimization');

  const startTime = Date.now();
  const memBefore = await si.mem();
  const opts = { ...appState.options, ...options };

  const steps = [
    { key: 'gameMode', name: 'Enabling Game Mode', fn: enableGameMode },
    { key: 'backgroundProcessTrim', name: 'Terminating background processes', fn: killBackgroundProcesses },
    { key: 'diskCleanup', name: 'Cleaning temporary files', fn: cleanTempFiles },
    { key: 'browserCacheCleanup', name: 'Clearing browser caches', fn: cleanBrowserCaches },
    { key: 'recycleBinEmpty', name: 'Emptying Recycle Bin', fn: emptyRecycleBin },
    { key: 'windowsUpdateCacheCleanup', name: 'Cleaning Windows Update cache', fn: cleanWindowsUpdateCache },
    { key: 'logsCleanup', name: 'Cleaning system logs', fn: cleanSystemLogs },
    { key: 'memoryCompression', name: 'Optimizing memory', fn: optimizeMemory },
    { key: 'storageOptimize', name: 'Optimizing storage', fn: optimizeStorage },
    { key: 'dnsSwitch', name: 'Optimizing DNS settings', fn: optimizeDNS },
    { key: 'tcpTune', name: 'Optimizing TCP settings', fn: optimizeTCP },
    { key: 'gpuVisualTuning', name: 'Optimizing visual effects', fn: optimizeVisualEffects },
    { key: 'hardwareGpuScheduling', name: 'Enabling GPU hardware scheduling', fn: enableHardwareGPUScheduling },
    { key: 'nvapi', name: 'Optimizing NVIDIA settings', fn: optimizeNVIDIA }
  ];

  const results = [];
  let totalJunkCleaned = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Pre-progress tick
    emitProgress(i, steps.length, step.name);

    if (!opts[step.key]) {
      results.push({ key: step.key, name: step.name, skipped: true, ok: true, durationMs: 0 });
      emitProgress(i + 1, steps.length, `${step.name} (skipped)`);
      continue;
    }

    const t0 = Date.now();
    let outcome;
    try {
      outcome = await step.fn();
    } catch (e) {
      outcome = { ok: false, error: e.message || 'Unknown error' };
    }
    const durationMs = Date.now() - t0;

    if (outcome && typeof outcome.cleanedGB === 'number') {
      totalJunkCleaned += outcome.cleanedGB;
    }

    results.push({
      key: step.key,
      name: step.name,
      ok: !!outcome?.ok,
      error: outcome?.error || null,
      extra: outcome,
      durationMs
    });

    emitProgress(i + 1, steps.length, step.name);
  }

  // RAM delta
  const memAfter = await si.mem();
  const beforeBytes = (memBefore.active || memBefore.used || 0);
  const afterBytes = (memAfter.active || memAfter.used || 0);
  const ramFreedGB = bytesToGB(Math.max(0, beforeBytes - afterBytes));

  appState.lastOptimization = new Date().toISOString();
  appState.lastRamFreedGB = parseFloat(ramFreedGB.toFixed(2));
  appState.lastJunkCleanedGB = parseFloat(totalJunkCleaned.toFixed(2));
  await saveSettings();

  // Report
  ensurePaths();
  const hwid = await getStableHWID();
  const report = {
    timestamp: appState.lastOptimization,
    hwid,
    optionsUsed: opts,
    results,
    summary: {
      durationMs: Date.now() - startTime,
      ramFreedGB: appState.lastRamFreedGB,
      junkCleanedGB: appState.lastJunkCleanedGB
    },
    versions: {
      app: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node
    }
  };
  try {
    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
  } catch (e) {
    logLine(`Failed to write report: ${e.message}`, true);
  }

  logLine(`Optimization complete. RAM freed: ${appState.lastRamFreedGB} GB, Junk cleaned: ${appState.lastJunkCleanedGB} GB`);

  sendToRenderer('optimization-complete', {
    ok: true,
    summary: report.summary,
    results
  });

  return { ok: true, summary: report.summary, results };
});

// Feature testing
ipcMain.handle('test-optimization-feature', async (_e, key) => {
  const map = {
    gameMode: enableGameMode,
    backgroundProcessTrim: killBackgroundProcesses,
    diskCleanup: cleanTempFiles,
    browserCacheCleanup: cleanBrowserCaches,
    recycleBinEmpty: emptyRecycleBin,
    windowsUpdateCacheCleanup: cleanWindowsUpdateCache,
    logsCleanup: cleanSystemLogs,
    memoryOptimization: optimizeMemory,
    networkOptimization: async () => {
      const a = await optimizeDNS();
      const b = await optimizeTCP();
      return { ok: a.ok && b.ok };
    },
    visualEffects: optimizeVisualEffects,
    gpuScheduling: enableHardwareGPUScheduling,
    nvapi: optimizeNVIDIA,
    startupItems: async () => ({ ok: true }) // placeholder
  };
  const fn = map[key];
  if (!fn) return { ok: false, error: `Unknown feature: ${key}` };
  try {
    const res = await fn();
    return { ok: !!res?.ok, result: res };
  } catch (e) {
    return { ok: false, error: e.message || 'Unknown error' };
  }
});

// Health Check
ipcMain.handle('run-system-health-check', async () => {
  if (!isWindows()) return { ok: false, error: 'Windows-only operation' };
  try {
    const [mem, load, fsSize, osInfo] = await Promise.all([
      si.mem(),
      si.currentLoad(),
      si.fsSize(),
      si.osInfo()
    ]);

    const totalGB = bytesToGB(mem.total);
    const usedGB = bytesToGB(mem.active || mem.used);
    const freeGB = Math.max(0, totalGB - usedGB);
    const cpuLoad = load.currentload || 0;
    const diskC = fsSize.find(d => (d.mount || '').toUpperCase() === 'C:');
    const diskFreePct = diskC ? (100 - (diskC.use || 0)) : 0;

    let latencyMs = null;
    try {
      const { stdout } = await execAsync('ping -n 1 8.8.8.8', { timeout: 5000, windowsHide: true });
      const match = stdout.match(/Average = (\d+)ms/i);
      if (match) latencyMs = parseInt(match[1], 10);
    } catch { /* ignore */ }

    let score = 100;
    if (cpuLoad > 85) score -= 20;
    if (freeGB < 2) score -= 20;
    if (diskFreePct < 10) score -= 15;
    if (latencyMs !== null) {
      if (latencyMs > 100) score -= 15;
      else if (latencyMs > 60) score -= 8;
    }
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      ok: true,
      score,
      details: {
        os: `${osInfo.distro} ${osInfo.release}`,
        cpuLoadPct: Math.round(cpuLoad),
        ram: { totalGB: totalGB.toFixed(2), usedGB: usedGB.toFixed(2), freeGB: freeGB.toFixed(2) },
        diskC: diskC ? { sizeGB: bytesToGB(diskC.size).toFixed(2), usedPct: diskC.use, freePct: (100 - diskC.use).toFixed(2) } : null,
        latencyMs
      }
    };
  } catch (e) {
    return { ok: false, error: e.message || 'Health check failed' };
  }
});

// Performance metrics
ipcMain.handle('get-performance-metrics', async () => {
  try {
    const [load, mem] = await Promise.all([si.currentLoad(), si.mem()]);
    return {
      ok: true,
      metrics: {
        cpuLoadPct: Math.round(load.currentload || 0),
        memUsedGB: (mem.active ? mem.active : mem.used) / (1024 ** 3),
        memTotalGB: mem.total / (1024 ** 3),
        appHeapMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
      }
    };
  } catch (e) {
    return { ok: false, error: e.message || 'Failed to read metrics' };
  }
});

// Restore Points
ipcMain.handle('create-restore-point', async (_e, description = 'Aura Restore Point') => {
  if (!isWindows()) return { ok: false, error: 'Windows-only operation' };
  try {
    const cmd = `PowerShell.exe -Command "Checkpoint-Computer -Description \\"${String(description).replace(/"/g, '\\"')}\\" -RestorePointType \\"MODIFY_SETTINGS\\""`;
    const res = await safeExec(cmd, { timeout: 120000 });
    if (!res.ok) throw new Error(res.error || 'Failed to create restore point');

    // App ledger
    ensurePaths();
    let ledger = [];
    try { ledger = JSON.parse(await fs.readFile(RESTORE_POINTS_PATH, 'utf-8')); } catch { /* ignore */ }
    ledger.push({ description, createdAt: new Date().toISOString() });
    await fs.writeFile(RESTORE_POINTS_PATH, JSON.stringify(ledger, null, 2));

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Failed to create restore point' };
  }
});

ipcMain.handle('get-restore-points', async () => {
  if (!isWindows()) return { ok: false, error: 'Windows-only operation' };
  try {
    const { stdout } = await execAsync(
      'PowerShell.exe -Command "Get-ComputerRestorePoint | ConvertTo-Json -Depth 3"',
      { timeout: 15000, windowsHide: true }
    );
    let points = [];
    try { points = JSON.parse(stdout || '[]'); } catch { points = []; }
    if (!Array.isArray(points)) points = [points];
    const normalized = points.map(p => ({
      id: p.SequenceNumber,
      description: p.Description,
      createdAt: p.CreationTime || p.CreationTimeUTC || null,
      size: 0
    }));
    return { ok: true, restorePoints: normalized };
  } catch (e) {
    return { ok: false, error: e.message || 'Failed to list restore points' };
  }
});

ipcMain.handle('restore-from-point', async (_e, pointId) => {
  if (!isWindows()) return { ok: false, error: 'Windows-only operation' };
  const idNum = parseInt(pointId, 10);
  if (!Number.isFinite(idNum)) return { ok: false, error: 'Invalid restore point id' };
  try {
    const cmd = `PowerShell.exe -Command "Restore-Computer -RestorePoint ${idNum}"`;
    const r = await safeExec(cmd, { timeout: 120000 });
    if (!r.ok) throw new Error(r.error || 'Restore command failed');
    return { ok: true, message: 'System Restore triggered. A reboot may be required.' };
  } catch (e) {
    return { ok: false, error: e.message || 'Failed to restore' };
  }
});

// Logs
ipcMain.handle('get-debug-logs', async () => {
  ensurePaths();
  try {
    const main = fsSync.existsSync(LOG_PATH) ? fsSync.readFileSync(LOG_PATH, 'utf-8') : '';
    const debug = fsSync.existsSync(DEBUG_LOG_PATH) ? fsSync.readFileSync(DEBUG_LOG_PATH, 'utf-8') : '';
    return { ok: true, logs: { main, debug } };
  } catch (e) {
    return { ok: false, error: e.message || 'Failed to read logs' };
  }
});
ipcMain.handle('clear-debug-logs', async () => {
  ensurePaths();
  try {
    await fs.writeFile(LOG_PATH, '');
    await fs.writeFile(DEBUG_LOG_PATH, '');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Failed to clear logs' };
  }
});

// Reports
ipcMain.handle('export-system-report', async () => {
  ensurePaths();
  try {
    if (!fsSync.existsSync(REPORT_PATH)) return { ok: false, error: 'No report found yet' };
    const content = await fs.readFile(REPORT_PATH, 'utf-8');
    return { ok: true, reportPath: REPORT_PATH, report: JSON.parse(content) };
  } catch (e) {
    return { ok: false, error: e.message || 'Failed to read report' };
  }
});
ipcMain.handle('get-last-report', async () => {
  ensurePaths();
  try {
    if (!fsSync.existsSync(REPORT_PATH)) return { ok: false, error: 'No report yet' };
    const report = JSON.parse(await fs.readFile(REPORT_PATH, 'utf-8'));
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: e.message || 'Failed to load report' };
  }
});

// External helpers used by preload dev tools
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));
ipcMain.handle('open-dev-tools', () => {
  if (appState.window) appState.window.webContents.openDevTools({ mode: 'detach' });
});
ipcMain.handle('reload-app', () => {
  if (appState.window) appState.window.reload();
});
ipcMain.handle('clear-cache', async () => {
  if (appState.window) await appState.window.webContents.session.clearCache();
  return { ok: true };
});

// App lifecycle
async function init() {
  ensurePaths();
  await loadSettings();
  await createWindow();           // show the window first
  await checkActivationOnLaunch();// then do async background work
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (appState.window) {
      if (appState.window.isMinimized()) appState.window.restore();
      appState.window.focus();
    }
  });

  app.whenReady().then(init);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
}

// Global error handlers
process.on('uncaughtException', (err) => {
  logLine(`UncaughtException: ${err.stack || err.message}`, true);
});
process.on('unhandledRejection', (reason) => {
  logLine(`UnhandledRejection: ${reason && reason.stack ? reason.stack : reason}`, true);
});
