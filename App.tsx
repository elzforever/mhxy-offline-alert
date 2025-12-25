
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
  Clock,
  Info
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
    meowCode: '', // Initialize meowCode
    checkInterval: 5, 
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
        const parsed = JSON.parse(savedSettings);
        // Migration support if needed, or just load valid keys
        setSettings(prev => ({ ...prev, ...parsed }));
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
        addLog('info', '屏幕捕获已成功启动。');
        
        // Handle stream stop (e.g. user clicks "Stop sharing" browser UI)
        stream.getVideoTracks()[0].onended = () => {
           stopCapture();
        };
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        addLog('warning', '用户拒绝了屏幕捕获权限。');
      } else {
        console.error(err);
        addLog('error', '启动屏幕捕获失败。');
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
    addLog('info', '捕获已停止。');
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
            addLog('warning', `检测到疑似掉线。正在验证(30秒)... 原因: ${result.reason}`);
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
              addLog('error', `触发报警: ${result.reason} (持续时间: ${Math.floor(durationMs/1000)}秒)`, imageData);
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
            addLog('success', '连接已恢复。报警逻辑已重置。');
            // Reset logic
            logic.disconnectStartTime = null;
            logic.lastAlertTime = null;
          }

          setState(prev => ({ 
            ...prev, 
            lastCheck: new Date(),
            status: 'scanning' 
          }));
        }

      } catch (err) {
        console.error(err);
        addLog('error', '分析周期失败。');
        setState(prev => ({ ...prev, status: 'idle' }));
      }
    }
  }, [settings, addLog]);

  const triggerAlert = async (result: DetectionResult, durationSec: number) => {
    const timestamp = new Date().toLocaleString();
    
    // 1. Miao Ti Xing (喵提醒) Notification
    if (settings.meowCode) {
      try {
        // Miao Ti Xing API: https://miaotixing.com/trigger
        const baseUrl = 'https://miaotixing.com/trigger';
        // Construct message
        const text = `游戏掉线提醒\n\n状态: 掉线了，掉线了\n原因: ${result.reason}\n持续时间: ${durationSec}秒\n时间: ${timestamp}`;
        
        const params = new URLSearchParams({
          id: settings.meowCode,
          text: text,
          type: 'json'
        });

        // Using GET with no-cors to simple trigger
        await fetch(`${baseUrl}?${params.toString()}`, {
          method: 'GET',
          mode: 'no-cors'
        });
        
        // Note: With no-cors we can't read the response, but the request is sent.
        // Meow notification usually accepts GET requests.
      } catch (e) {
        console.error("Meow notification failed", e);
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
      new Notification("游戏掉线警报!", {
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
      addLog('warning', '请先启动屏幕捕获，然后再开始监控。');
      return;
    }
    
    if ("Notification" in window) {
      Notification.requestPermission();
    }

    // Reset logic when starting fresh
    alertLogic.current = { disconnectStartTime: null, lastAlertTime: null };

    setState(prev => ({ ...prev, isMonitoring: true, status: 'scanning' }));
    addLog('info', `监控已启动。每 ${settings.checkInterval} 秒检测一次。`);
    
    performCheck();
    intervalRef.current = window.setInterval(performCheck, settings.checkInterval * 1000);
  };

  const stopMonitoring = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState(prev => ({ ...prev, isMonitoring: false, status: 'idle' }));
    addLog('info', '监控已暂停。');
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
              GameWatch AI 游戏掉线监控
            </h1>
            <p className="text-slate-400 text-sm">智能画面识别与报警工具</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-3 rounded-xl transition-all ${showSettings ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            title="设置"
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
                  <span>开始屏幕捕获</span>
                </button>
                <p className="text-slate-500 text-sm px-8 text-center">
                  请选择您的游戏窗口或整个屏幕以开始监控。
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
                    {state.status === 'alert' ? '已掉线' : 
                     state.status === 'scanning' ? '监控中' : 
                     '待机'}
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
                  <span>暂停监控</span>
                </button>
              ) : (
                <button 
                  onClick={startMonitoring}
                  className={`px-6 py-2.5 bg-green-600/20 text-green-500 border border-green-600/50 rounded-xl font-bold flex items-center space-x-2 hover:bg-green-600/30 transition-colors ${!isCapturing ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={!isCapturing}
                >
                  <Play className="w-5 h-5" />
                  <span>恢复监控</span>
                </button>
              )}

              <button 
                onClick={stopCapture}
                className="px-4 py-2.5 bg-slate-700 text-slate-300 rounded-xl hover:bg-slate-600 transition-colors"
              >
                停止捕获
              </button>
            </div>

            <div className="text-right">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-widest">上次检测</p>
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
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 h-full overflow-y-auto">
              <h3 className="text-lg font-bold mb-6 flex items-center space-x-2">
                <ShieldAlert className="w-5 h-5 text-indigo-400" />
                <span>报警设置 & 使用说明</span>
              </h3>

              {/* Guide Section */}
              <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-xl mb-6">
                <div className="flex items-center text-sm font-bold text-blue-300 mb-2">
                  <Info className="w-4 h-4 mr-2" />
                  使用说明 & 注意事项
                </div>
                <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside leading-relaxed">
                  <li>
                    <span className="text-white font-semibold">获取 喵码:</span> 前往 <a href="http://miaotixing.com/" target="_blank" rel="noreferrer" className="text-indigo-400 underline">喵提醒 (miaotixing.com)</a> 注册账号并创建提醒，获取您的“喵码”。
                  </li>
                  <li>
                    <span className="text-white font-semibold">配置:</span> 将 喵码 复制到下方的输入框中。
                  </li>
                  <li>
                    <span className="text-white font-semibold">启动:</span> 点击“开始屏幕捕获”，选择游戏窗口，然后点击“恢复监控”。
                  </li>
                  <li>
                    <span className="text-white font-semibold">注意:</span> 请确保游戏窗口保持在屏幕上可见（不要最小化），否则无法进行图像识别。
                  </li>
                </ol>
              </div>
              
              <div className="space-y-6">
                
                {/* Meow Code Input */}
                <div className="bg-indigo-900/20 p-4 rounded-xl border border-indigo-500/30">
                  <label className="block text-xs font-bold text-indigo-300 uppercase mb-2 flex items-center">
                    <MessageSquare className="w-3 h-3 mr-1" /> 喵提醒 喵码 (Meow Code)
                  </label>
                  <input 
                    type="password"
                    placeholder="在此粘贴您的 喵码 (例如: txxxxxx)"
                    value={settings.meowCode}
                    onChange={(e) => setSettings({...settings, meowCode: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-white placeholder-slate-600"
                  />
                  <p className="text-[10px] text-slate-400 mt-2">
                    必填项：用于发送微信报警通知 (通过喵提醒公众号)。
                  </p>
                </div>

                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700 space-y-2">
                  <div className="flex items-center text-xs font-bold text-slate-300 mb-2">
                    <Clock className="w-3 h-3 mr-1.5 text-indigo-400" />
                    <span>智能报警逻辑</span>
                  </div>
                  <ul className="text-[10px] text-slate-400 space-y-1 list-disc list-inside">
                    <li>首次报警: <span className="text-indigo-300">检测到掉线 30秒 后</span></li>
                    <li>重复频率: <span className="text-indigo-300">每 60秒 一次</span></li>
                    <li>超时停止: <span className="text-indigo-300">持续 10分钟 后不再发送</span></li>
                  </ul>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">检测间隔 (秒)</label>
                  <input 
                    type="range" min="5" max="60" step="5"
                    value={settings.checkInterval}
                    onChange={(e) => setSettings({...settings, checkInterval: parseInt(e.target.value)})}
                    className="w-full accent-indigo-500"
                  />
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>5秒</span>
                    <span className="text-indigo-400 font-bold">{settings.checkInterval}秒</span>
                    <span>60秒</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">AI 灵敏度</label>
                  <input 
                    type="range" min="0.1" max="1.0" step="0.1"
                    value={settings.sensitivity}
                    onChange={(e) => setSettings({...settings, sensitivity: parseFloat(e.target.value)})}
                    className="w-full accent-indigo-500"
                  />
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>低</span>
                    <span className="text-indigo-400 font-bold">{Math.round(settings.sensitivity * 100)}%</span>
                    <span>高</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2 flex items-center">
                    <Smartphone className="w-3 h-3 mr-1" /> 通用 Webhook (可选)
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
                  保存并返回
                </button>
              </div>
            </div>
          ) : (
            /* Logs Section */
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 h-full flex flex-col">
              <h3 className="text-lg font-bold mb-4 flex items-center space-x-2">
                <History className="w-5 h-5 text-indigo-400" />
                <span>运行日志</span>
              </h3>
              
              <div className="flex-grow overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                {state.logs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                    <Bell className="w-12 h-12 mb-2 opacity-20" />
                    <p className="text-sm">暂无活动记录。</p>
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
                          {log.type === 'error' ? '错误' : 
                           log.type === 'success' ? '正常' : 
                           log.type === 'warning' ? '警告' : '信息'}
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
        <p>© 2024 GameWatch AI - 由 Gemini 3 驱动。请确保监控窗口保持在前台或可见状态。</p>
      </footer>
    </div>
  );
};

export default App;
