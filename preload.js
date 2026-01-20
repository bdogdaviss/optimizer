// preload.js - Hybrid version maintaining backward compatibility
const { contextBridge, ipcRenderer } = require('electron');

// Enhanced secure API with backward compatibility
contextBridge.exposeInMainWorld('electronAPI', {
  // === EXISTING APIs (maintained for compatibility) ===
  
  // Licensing (your original format)
  getHwid: () => ipcRenderer.invoke('get-hwid'),
  activateLicense: (key, hwid) => ipcRenderer.invoke('activate-license', { key, hwid }),
  logout: () => ipcRenderer.invoke('logout'),
  
  // Optimizer (your original format)
  performOptimization: (options) => ipcRenderer.invoke('perform-optimization', options),
  getSystemStats: () => ipcRenderer.invoke('get-system-stats'),
  toggleOptimizer: (isEnabled) => ipcRenderer.invoke('toggle-optimizer', isEnabled),
  
  // Options persistence (your original format)
  getOptions: () => ipcRenderer.invoke('get-options'),
  setOptions: (opts) => ipcRenderer.invoke('set-options', opts),
  
  // Diagnostics (your original format)
  getLastReport: () => ipcRenderer.invoke('get-last-report'),

  // === NEW ENHANCED APIs ===
  
  // Alternative naming for consistency (can use either)
  getHWID: () => ipcRenderer.invoke('get-hwid'),
  
  // Enhanced system monitoring
  getPerformanceMetrics: () => ipcRenderer.invoke('get-performance-metrics'),
  runSystemHealthCheck: () => ipcRenderer.invoke('run-system-health-check'),

  // Restore points management
  createRestorePoint: (description) => ipcRenderer.invoke('create-restore-point', description),
  getRestorePoints: () => ipcRenderer.invoke('get-restore-points'),
  restoreFromPoint: (pointId) => ipcRenderer.invoke('restore-from-point', pointId),

  // Debug and testing features
  toggleDebugMode: (enabled) => ipcRenderer.invoke('toggle-debug-mode', enabled),
  testOptimizationFeature: (featureKey) => ipcRenderer.invoke('test-optimization-feature', featureKey),
  getDebugLogs: () => ipcRenderer.invoke('get-debug-logs'),
  clearDebugLogs: () => ipcRenderer.invoke('clear-debug-logs'),
  exportSystemReport: () => ipcRenderer.invoke('export-system-report'),

  // External utilities
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // === EVENT LISTENERS (enhanced from your version) ===
  
  // Optimization events (improved cleanup)
  onOptimizationProgress: (cb) => {
    ipcRenderer.removeAllListeners('optimization-progress');
    ipcRenderer.on('optimization-progress', (_event, payload) => cb(payload));
  },
  onOptimizationComplete: (cb) => {
    ipcRenderer.removeAllListeners('optimization-complete');
    ipcRenderer.on('optimization-complete', (_event, payload) => cb(payload));
  },

  // Generic event cleanup
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // === DEVELOPMENT UTILITIES ===
  isDevelopment: process.env.NODE_ENV === 'development',
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }
});

// === WINDOW CONTROLS (enhanced from your version) ===
contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'), // NEW: Added maximize
  close: () => ipcRenderer.send('window-close')
});

// === SECURITY ENHANCEMENTS (NEW) ===

// Block direct access to Node.js APIs
Object.defineProperty(window, 'require', {
  get() {
    console.warn('❌ Direct require() access blocked for security');
    return undefined;
  }
});

Object.defineProperty(window, 'process', {
  get() {
    console.warn('❌ Direct process access blocked for security');
    return undefined;
  }
});

Object.defineProperty(window, 'global', {
  get() {
    console.warn('❌ Direct global access blocked for security');
    return undefined;
  }
});

// === ERROR HANDLING (NEW) ===

// Handle renderer process errors
window.addEventListener('error', (event) => {
  console.error('🔴 Renderer process error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('🔴 Unhandled promise rejection in renderer:', event.reason);
});

// === DEVELOPMENT HELPERS (NEW) ===

if (process.env.NODE_ENV === 'development') {
  window.addEventListener('DOMContentLoaded', () => {
    console.log('✅ Preload script loaded successfully');
    console.log('📡 Available APIs:', Object.keys(window.electronAPI));
    console.log('🪟 Window Controls:', Object.keys(window.windowControls));
  });

  // Development shortcuts
  contextBridge.exposeInMainWorld('devTools', {
    openDevTools: () => ipcRenderer.invoke('open-dev-tools'),
    reloadApp: () => ipcRenderer.invoke('reload-app'),
    clearCache: () => ipcRenderer.invoke('clear-cache')
  });
}

console.log('🚀 Enhanced Preload script initialized - Secure IPC bridge established');