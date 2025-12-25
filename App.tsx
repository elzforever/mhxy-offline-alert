
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MonitorState, MonitorLog, DetectionResult, Settings } from './types';
import { GeminiService } from './services/geminiService';
import { 
  Bell, 
  Settings as SettingsIcon, 
  Activity, 
  Camera, 
  StopCircle, 
  Play, 
  History,
  ShieldAlert,
  Smartphone,
  MessageSquare,
  Clock
} from 'lucide-react';

const App: React.FC = () => {
  // --- State ---
  const [state, setState] = useState<MonitorState>({
    isMonitoring: false,
    status: 'idle',
    lastCheck: null,
    logs: []
  });

  const [settings, setSettings] = useState<Settings>({
    webhookUrl: '',
    pushPlusToken: '',
    checkInterval: 5, // Default to faster checks for smoother logic
    sensitivity: 0.7
  });

  const [showSettings, setShowSettings] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geminiRef = useRef<GeminiService | null>(null);
  const intervalRef = useRef<number | null>(null);

  // Logic Refs (Using refs instead of state to avoid stale closure issues in setInterval)
  const alertLogic = useRef<{
    disconnectStartTime: number | null;
    lastAlertTime: number | null;
  }>({ disconnectStartTime: null, lastAlertTime: null });

  // --- Initialization ---
  useEffect(() => {
    geminiRef.current = new GeminiService();
    
    // Load settings from local storage if available
    const savedSettings = localStorage.getItem('gw_settings');
    if (savedSettings) {
      try {
        setSettings(JSON.parse(savedSettings));
      } catch (e) { console.error("Failed to load settings"); }
    }
  }, []);

  // Save settings when changed
  useEffect(() => {
    localStorage.setItem('gw_settings', JSON.stringify(settings));
  }, [settings]);

  // --- Methods ---
  const addLog = useCallback((type: MonitorLog['type'], message: string, imageUrl?: string) => {
    const newLog: MonitorLog = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      type,
      message,
      imageUrl
    };
    setState(prev => ({
      ...prev,
      logs: [newLog, ...prev.logs].slice(0, 50)
    }));
  }, []);

  const startScreenCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setIsCapturing(true);
        addLog('info', 'Screen capture started successfully.');
        
        // Handle stream stop (e.g. user clicks "Stop sharing" browser UI)
        stream.getVideoTracks()[0].onended = () => {
           stopCapture();
        };
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        addLog('warning', 'Screen capture permission denied by user.');
      } else {
        console.error(err);
        addLog('error', 'Failed to start screen capture.');
      }
    }
  };

  const stopCapture = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCapturing(false);
    stopMonitoring();
    addLog('info', 'Capture stopped.');
  };

  const performCheck = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !geminiRef.current) return;

    // Use a temp var for current logic to ensure consistency
    const logic = alertLogic.current;
    
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const context = canvas.getContext('2d');
    
    if (context) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = canvas.toDataURL('image/jpeg', 0.8);

      try {
        const result: DetectionResult = await geminiRef.current.analyzeFrame(imageData);
        const now = Date.now();
        const isDisconnected = result.isDisconnected && result.confidence >= settings.sensitivity;

        // Logic Update
        if (isDisconnected) {
          // 1. Initialize Start Time if new disconnect
          if (!logic.disconnectStartTime) {
            logic.disconnectStartTime = now;
            addLog('warning', `Potential disconnection detected. Verifying for 30s... Reason: ${result.reason}`);
          }

          const durationMs = now - logic.disconnectStartTime;
          
          // 2. Alert Logic
          // Max duration 10 minutes (600,000 ms)
          if (durationMs < 600000) {
            let shouldAlert = false;

            // Initial Alert: Wait 30 seconds (30,000 ms)
            if (durationMs >= 30000) {
               if (!logic.lastAlertTime) {
                 // First alert
                 shouldAlert = true;
               } else if (now - logic.lastAlertTime >= 60000) {
                 // Follow-up alerts: Every 60 seconds (60,000 ms)
                 shouldAlert = true;
               }
            }

            if (shouldAlert) {
              await triggerAlert(result, Math.floor(durationMs / 1000));
              logic.lastAlertTime = now;
              addLog('error', `ALERT TRIGGERED: ${result.reason} (Duration: ${Math.floor(durationMs/1000)}s)`, imageData);
            }
          }

          setState(prev => ({ 
            ...prev, 
            lastCheck: new Date(),
            status: 'alert'
          }));

        } else {
          // Connected
          if (logic.disconnectStartTime) {
            addLog('success', 'Connection restored. Logic reset.');
            // Reset logic
            logic.disconnectStartTime = null;
            logic.lastAlertTime = null;
          }

          setState(prev => ({ 
            ...prev, 
            lastCheck: new Date(),
            status: 'scanning' 
          }));
          
          // Optional: Log every few checks if desired, or keep it quiet to avoid spam
          // addLog('success', `Status check: Online.`);
        }

      } catch (err) {
        console.error(err);
        addLog('error', 'Analysis cycle failed.');
        setState(prev => ({ ...prev, status: 'idle' }));
      }
    }
  }, [settings, addLog]);

  const triggerAlert = async (result: DetectionResult, durationSec: number) => {
    const timestamp = new Date().toLocaleString();
    
    // 1. PushPlus (WeChat) Notification
    if (settings.pushPlusToken) {
      try {
        const baseUrl = 'https://www.pushplus.plus/send';
        const params = new URLSearchParams({
          token: settings.pushPlusToken,
          title: '游戏掉线提醒',
          content: `掉线了，掉线了<br><br>原因: ${result.reason}<br>持续时间: ${durationSec}秒<br>时间: ${timestamp}`,
          template: 'html'
        });

        await fetch(`${baseUrl}?${params.toString()}`, {
          method: 'GET',
          mode: 'no-cors'
        });
        
      } catch (e) {
        console.error("PushPlus failed", e);
      }
    }

    // 2. Generic Webhook
    if (settings.webhookUrl) {
      fetch(settings.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'GAME_DISCONNECTED',
          reason: result.reason,
          duration: durationSec,
          timestamp: new Date().toISOString()
        })
      }).catch(e => console.error("Webhook failed", e));
    }
    
    // 3. Browser notification
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("GameWatch Alert!", {
        body: `掉线了！持续时间: ${durationSec}s. 原因: ${result.reason}`,
        icon: "https://picsum.photos/100/100"
      });
    }
    
    // 4. In-app visual / audio alert
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.play().catch(() => {});
  };

  const startMonitoring = () => {
    if (!isCapturing) {
      addLog('warning', 'Start screen capture first before monitoring.');
      return;
    }
    
    if ("Notification" in window) {
      Notification.requestPermission();
    }

    // Reset logic when starting fresh
    alertLogic.current = { disconnectStartTime: null, lastAlertTime: null };

    setState(prev => ({ ...prev, isMonitoring: true, status: 'scanning' }));
    addLog('info', `Monitoring started. Checking every ${settings.checkInterval}s`);
    
    performCheck();
    intervalRef.current = window.setInterval(performCheck, settings.checkInterval * 1000);
  };

  const stopMonitoring = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState(prev => ({ ...prev, isMonitoring: false, status: 'idle' }));
    addLog('info', 'Monitoring paused.');
  };

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between bg-slate-800/50 p-6 rounded-2xl border border-slate-700 backdrop-blur-md">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-500/20">
            <Activity className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              GameWatch AI
            </h1>
            <p className="text-slate-400 text-sm">Disconnection Monitor & Alerter</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-3 rounded-xl transition-all ${showSettings ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            <SettingsIcon className="w-6 h-6" />
          </button>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-grow">
        
        {/* Monitoring Area */}
        <section className="lg:col-span-2 space-y-6">
          <div className="relative bg-black rounded-3xl overflow-hidden aspect-video shadow-2xl border-2 border-slate-700">
            {!isCapturing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4 bg-slate-900/80 backdrop-blur-sm z-10">
                <Camera className="w-16 h-16 text-slate-600" />
                <button 
                  onClick={startScreenCapture}
                  className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-semibold transition-all shadow-xl shadow-indigo-500/20 flex items-center space-x-2"
                >
                  <Play className="w-5 h-5" />
                  <span>Start Screen Capture</span>
                </button>
                <p className="text-slate-500 text-sm px-8 text-center">
                  Select your game window or the entire screen to start monitoring.
                </p>
              </div>
            )}
            
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className={`w-full h-full object-contain ${state.status === 'alert' ? 'pulse-error ring-4 ring-red-500 ring-inset' : ''}`} 
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Overlay Status */}
            {isCapturing && (
              <div className="absolute top-4 left-4 flex items-center space-x-3 pointer-events-none">
                <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full backdrop-blur-md border ${
                  state.status === 'alert' ? 'bg-red-500/20 border-red-500 text-red-400' : 
                  state.status === 'scanning' ? 'bg-green-500/20 border-green-500 text-green-400' : 
                  'bg-slate-800/50 border-slate-600 text-slate-400'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    state.status === 'alert' ? 'bg-red-500 animate-pulse' : 
                    state.status === 'scanning' ? 'bg-green-500 animate-ping' : 
                    'bg-slate-400'
                  }`} />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {state.status === 'alert' ? 'DISCONNECTED' : 
                     state.status === 'scanning' ? 'MONITORING ACTIVE' : 
                     'STANDBY'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Controls Bar */}
          <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center space-x-4">
              {state.isMonitoring ? (
                <button 
                  onClick={stopMonitoring}
                  className="px-6 py-2.5 bg-yellow-600/20 text-yellow-500 border border-yellow-600/50 rounded-xl font-bold flex items-center space-x-2 hover:bg-yellow-600/30 transition-colors"
                >
                  <StopCircle className="w-5 h-5" />
                  <span>Pause Monitor</span>
                </button>
              ) : (
                <button 
                  onClick={startMonitoring}
                  className={`px-6 py-2.5 bg-green-600/20 text-green-500 border border-green-600/50 rounded-xl font-bold flex items-center space-x-2 hover:bg-green-600/30 transition-colors ${!isCapturing ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={!isCapturing}
                >
                  <Play className="w-5 h-5" />
                  <span>Resume Monitor</span>
                </button>
              )}

              <button 
                onClick={stopCapture}
                className="px-4 py-2.5 bg-slate-700 text-slate-300 rounded-xl hover:bg-slate-600 transition-colors"
              >
                Stop Capture
              </button>
            </div>

            <div className="text-right">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-widest">Last Check</p>
              <p className="text-slate-200 font-mono">
                {state.lastCheck ? state.lastCheck.toLocaleTimeString() : '--:--:--'}
              </p>
            </div>
          </div>
        </section>

        {/* Sidebar */}
        <aside className="space-y-6">
          {/* Settings Section */}
          {showSettings ? (
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 h-full">
              <h3 className="text-lg font-bold mb-6 flex items-center space-x-2">
                <ShieldAlert className="w-5 h-5 text-indigo-400" />
                <span>Alert Configuration</span>
              </h3>
              
              <div className="space-y-6">
                
                {/* PushPlus Token Input */}
                <div className="bg-indigo-900/20 p-4 rounded-xl border border-indigo-500/30">
                  <label className="block text-xs font-bold text-indigo-300 uppercase mb-2 flex items-center">
                    <MessageSquare className="w-3 h-3 mr-1" /> PushPlus Token (WeChat)
                  </label>
                  <input 
                    type="password"
                    placeholder="Paste your PushPlus token here"
                    value={settings.pushPlusToken}
                    onChange={(e) => setSettings({...settings, pushPlusToken: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-white placeholder-slate-600"
                  />
                  <p className="text-[10px] text-slate-400 mt-2">
                    Get your token at <a href="http://www.pushplus.plus" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">pushplus.plus</a> to receive WeChat alerts.
                  </p>
                </div>

                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700 space-y-2">
                  <div className="flex items-center text-xs font-bold text-slate-300 mb-2">
                    <Clock className="w-3 h-3 mr-1.5 text-indigo-400" />
                    <span>Smart Alert Logic</span>
                  </div>
                  <ul className="text-[10px] text-slate-400 space-y-1 list-disc list-inside">
                    <li>First alert: <span className="text-indigo-300">30s after detection</span></li>
                    <li>Repeats: <span className="text-indigo-300">Every 60s</span></li>
                    <li>Timeout: <span className="text-indigo-300">Stops after 10 mins</span></li>
                  </ul>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Check Interval (seconds)</label>
                  <input 
                    type="range" min="5" max="60" step="5"
                    value={settings.checkInterval}
                    onChange={(e) => setSettings({...settings, checkInterval: parseInt(e.target.value)})}
                    className="w-full accent-indigo-500"
                  />
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>5s</span>
                    <span className="text-indigo-400 font-bold">{settings.checkInterval}s</span>
                    <span>60s</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">AI Sensitivity</label>
                  <input 
                    type="range" min="0.1" max="1.0" step="0.1"
                    value={settings.sensitivity}
                    onChange={(e) => setSettings({...settings, sensitivity: parseFloat(e.target.value)})}
                    className="w-full accent-indigo-500"
                  />
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>Low</span>
                    <span className="text-indigo-400 font-bold">{Math.round(settings.sensitivity * 100)}%</span>
                    <span>High</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2 flex items-center">
                    <Smartphone className="w-3 h-3 mr-1" /> Generic Webhook (Optional)
                  </label>
                  <input 
                    type="text"
                    placeholder="https://maker.ifttt.com/trigger/..."
                    value={settings.webhookUrl}
                    onChange={(e) => setSettings({...settings, webhookUrl: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full py-3 bg-indigo-600 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20"
                >
                  Save & Return
                </button>
              </div>
            </div>
          ) : (
            /* Logs Section */
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 h-full flex flex-col">
              <h3 className="text-lg font-bold mb-4 flex items-center space-x-2">
                <History className="w-5 h-5 text-indigo-400" />
                <span>Activity Logs</span>
              </h3>
              
              <div className="flex-grow overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                {state.logs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                    <Bell className="w-12 h-12 mb-2 opacity-20" />
                    <p className="text-sm">No activity recorded yet.</p>
                  </div>
                ) : (
                  state.logs.map((log) => (
                    <div key={log.id} className="p-3 bg-slate-900/50 rounded-xl border border-slate-800 text-xs">
                      <div className="flex justify-between items-start mb-1">
                        <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] uppercase ${
                          log.type === 'error' ? 'bg-red-500/20 text-red-400' :
                          log.type === 'success' ? 'bg-green-500/20 text-green-400' :
                          log.type === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-indigo-500/20 text-indigo-400'
                        }`}>
                          {log.type}
                        </span>
                        <span className="text-slate-500 tabular-nums">
                          {log.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-slate-300 leading-relaxed">{log.message}</p>
                      {log.imageUrl && (
                        <div className="mt-2 rounded-lg overflow-hidden border border-red-500/30">
                          <img src={log.imageUrl} alt="Detection Frame" className="w-full h-auto" />
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </aside>
      </main>

      {/* Footer Info */}
      <footer className="text-center py-4 text-slate-500 text-xs">
        <p>© 2024 GameWatch AI Powered by Gemini 3. Ensure your screen remains visible for monitoring.</p>
      </footer>
    </div>
  );
};

export default App;
