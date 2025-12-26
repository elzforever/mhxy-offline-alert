import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MonitorState, MonitorLog, DetectionResult, Settings } from './types';
import { OcrService } from './services/ocrService';
import { 
  Bell, 
  Settings as SettingsIcon, 
  Camera, 
  StopCircle, 
  Play, 
  History,
  ShieldAlert,
  MessageSquare,
  Cpu,
  Send,
  Wifi,
  WifiOff,
  Upload,
  CheckCircle2,
  XCircle,
  Bug,
  Volume2,
  VolumeX,
  Eye
} from 'lucide-react';

interface QueuedAlert {
  id: string;
  url: string;
  body?: string; // For webhooks
  type: 'meow' | 'webhook';
  timestamp: number;
}

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
    meowCode: '', 
    checkInterval: 5, 
    sensitivity: 0.6,
    enableLocalSound: false 
  });

  const [showSettings, setShowSettings] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isNetworkOnline, setIsNetworkOnline] = useState(navigator.onLine);
  const [pendingAlertCount, setPendingAlertCount] = useState(0);

  // Testing State
  const [testResult, setTestResult] = useState<DetectionResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ocrRef = useRef<OcrService | null>(null);
  const intervalRef = useRef<number | null>(null);
  const alertQueue = useRef<QueuedAlert[]>([]);

  // Logic Refs
  const alertLogic = useRef<{
    disconnectStartTime: number | null;
    lastAlertTime: number | null;
  }>({ disconnectStartTime: null, lastAlertTime: null });

  // --- Initialization ---
  useEffect(() => {
    ocrRef.current = new OcrService();
    
    const savedSettings = localStorage.getItem('gw_settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        // Ensure new property exists even if loading old settings
        setSettings(prev => ({ 
          ...prev, 
          ...parsed,
          enableLocalSound: parsed.enableLocalSound ?? false 
        }));
      } catch (e) { console.error("Failed to load settings"); }
    }

    // Network Listeners
    const handleOnline = () => {
      setIsNetworkOnline(true);
      addLog('success', '网络已恢复连接，正在检查待发送报警...');
      processAlertQueue();
    };
    const handleOffline = () => {
      setIsNetworkOnline(false);
      addLog('warning', '本机网络已断开。报警将存入队列等待重连。');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      ocrRef.current?.terminate();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();
    };
  }, []);

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

  // --- TTS Helper ---
  const playTTS = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    
    // Cancel previous
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN'; // Force Chinese
    utterance.rate = 1.0;
    utterance.pitch = 1.1;
    utterance.volume = 1.0;
    
    window.speechSynthesis.speak(utterance);
  };

  // --- Queue Processing ---
  const processAlertQueue = async () => {
    if (alertQueue.current.length === 0) return;

    const queue = [...alertQueue.current];
    alertQueue.current = []; // Clear queue immediately to prevent duplicates
    setPendingAlertCount(0);

    addLog('info', `正在补发 ${queue.length} 条积压的报警...`);

    for (const alert of queue) {
      try {
        if (alert.type === 'meow') {
           new Image().src = alert.url;
        } else if (alert.type === 'webhook' && alert.body) {
           await fetch(alert.url, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: alert.body
           });
        }
        // Small delay to prevent rate limiting
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.error("Retry failed for alert", alert.id);
      }
    }
  };

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
    if (!videoRef.current || !canvasRef.current || !ocrRef.current) return;

    const logic = alertLogic.current;
    
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const context = canvas.getContext('2d');
    
    if (context) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = canvas.toDataURL('image/jpeg', 1.0);

      try {
        const result: DetectionResult = await ocrRef.current.analyzeFrame(imageData);
        const now = Date.now();
        
        if (result.reason && (result.reason.startsWith("OCR Model Loading"))) {
           return;
        }

        const isDisconnected = result.isDisconnected && result.confidence >= settings.sensitivity;

        // Logic Update
        if (isDisconnected) {
          if (!logic.disconnectStartTime) {
            logic.disconnectStartTime = now;
            addLog('warning', `OCR 检测到关键字。正在验证(15秒)... 原因: ${result.reason}`);
          }

          const durationMs = now - logic.disconnectStartTime;
          
          if (durationMs < 600000) {
            let shouldAlert = false;

            // Initial Alert: Wait 15 seconds
            if (durationMs >= 15000) {
               if (!logic.lastAlertTime) {
                 shouldAlert = true;
               } else if (now - logic.lastAlertTime >= 60000) {
                 shouldAlert = true;
               }
            }

            if (shouldAlert) {
              await triggerAlert(result, Math.floor(durationMs / 1000));
              logic.lastAlertTime = now;
              // Log with the processed image if available, else original
              addLog('error', `触发报警: ${result.reason} (持续时间: ${Math.floor(durationMs/1000)}秒)`, result.processedImage || imageData);
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
            addLog('success', '未检测到掉线关键字。报警逻辑已重置。');
            logic.disconnectStartTime = null;
            logic.lastAlertTime = null;
            window.speechSynthesis.cancel(); // Stop shouting if connected
          }

          setState(prev => ({ 
            ...prev, 
            lastCheck: new Date(),
            status: 'scanning' 
          }));
        }

        // Try processing queue if we are online and have items (double check mechanism)
        if (navigator.onLine && alertQueue.current.length > 0) {
           processAlertQueue();
        }

      } catch (err) {
        console.error(err);
        addLog('error', 'OCR 分析失败。');
        setState(prev => ({ ...prev, status: 'idle' }));
      }
    }
  }, [settings, addLog]);

  const triggerAlert = async (result: DetectionResult, durationSec: number) => {
    const timestamp = new Date().toLocaleString();
    const isOnline = navigator.onLine;

    // 0. Local TTS Alert (Highest priority for local user)
    if (settings.enableLocalSound) {
      playTTS("游戏掉线了，请尽快重新登录。");
    } else {
      // Fallback to simple beep if TTS is off
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
      audio.volume = 0.5;
      audio.play().catch(() => {});
    }

    // 1. Miao Ti Xing
    if (settings.meowCode) {
      const baseUrl = 'https://miaotixing.com/trigger';
      // Mention if this is a delayed report
      const prefix = isOnline ? "" : "[延迟补发] ";
      const text = `${prefix}游戏掉线提醒 (OCR)\n\n状态: 掉线了\n识别内容: ${result.reason}\n持续时间: ${durationSec}秒\n时间: ${timestamp}`;
      
      const params = new URLSearchParams({
        id: settings.meowCode,
        text: text,
        type: 'json'
      });
      const fullUrl = `${baseUrl}?${params.toString()}`;

      if (isOnline) {
        new Image().src = fullUrl;
        console.log("Sent Meow Notification");
      } else {
        alertQueue.current.push({
          id: Math.random().toString(),
          url: fullUrl,
          type: 'meow',
          timestamp: Date.now()
        });
        setPendingAlertCount(prev => prev + 1);
        console.log("Queued Meow Notification");
      }
    }

    // 2. Webhook
    if (settings.webhookUrl) {
      const body = JSON.stringify({
        event: 'GAME_DISCONNECTED',
        method: 'LOCAL_OCR',
        reason: result.reason,
        duration: durationSec,
        timestamp: new Date().toISOString()
      });

      if (isOnline) {
        fetch(settings.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body
        }).catch(e => console.error("Webhook failed", e));
      } else {
        alertQueue.current.push({
          id: Math.random().toString(),
          url: settings.webhookUrl,
          type: 'webhook',
          body: body,
          timestamp: Date.now()
        });
        setPendingAlertCount(prev => prev + 1);
      }
    }
    
    // 3. Browser notification (Local, so always works)
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("游戏掉线警报!", {
        body: `掉线了！持续时间: ${durationSec}s. 原因: ${result.reason}`,
        icon: "https://picsum.photos/100/100"
      });
    }
  };

  const handleTestAlert = () => {
    addLog('info', '正在测试报警...');
    triggerAlert({
      isDisconnected: true,
      confidence: 1.0,
      reason: "用户手动测试"
    }, 0);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !ocrRef.current) return;

    setIsTesting(true);
    setTestResult(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      try {
        const result = await ocrRef.current!.analyzeFrame(base64);
        setTestResult(result);
      } catch (err) {
        console.error("Test failed", err);
      } finally {
        setIsTesting(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const startMonitoring = () => {
    if (!isCapturing) {
      addLog('warning', '请先启动屏幕捕获，然后再开始监控。');
      return;
    }
    
    if ("Notification" in window) {
      Notification.requestPermission();
    }

    alertLogic.current = { disconnectStartTime: null, lastAlertTime: null };

    setState(prev => ({ ...prev, isMonitoring: true, status: 'scanning' }));
    addLog('info', `本地 OCR 监控已启动。每 ${settings.checkInterval} 秒检测一次。`);
    
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
    window.speechSynthesis.cancel();
  };

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between bg-slate-800/50 p-6 rounded-2xl border border-slate-700 backdrop-blur-md">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-emerald-600 rounded-xl shadow-lg shadow-emerald-500/20">
            <Cpu className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-emerald-400">
              GameWatch OCR (本地版)
            </h1>
            <p className="text-slate-400 text-sm">本地图像文字识别监控 - 无需 API Key</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          {/* Network Status Indicator */}
          <div className={`flex items-center space-x-2 px-4 py-2 rounded-xl border ${
            isNetworkOnline 
            ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' 
            : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {isNetworkOnline ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
            <span className="text-xs font-bold uppercase hidden md:inline">
              {isNetworkOnline ? '网络在线' : '网络断开'}
            </span>
          </div>

          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-3 rounded-xl transition-all ${showSettings ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
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
                  className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full font-semibold transition-all shadow-xl shadow-emerald-500/20 flex items-center space-x-2"
                >
                  <Play className="w-5 h-5" />
                  <span>开始屏幕捕获</span>
                </button>
                <p className="text-slate-500 text-sm px-8 text-center">
                  无需联网上传。本地识别保障隐私。
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
              <div className="absolute top-4 left-4 flex flex-col space-y-2 pointer-events-none">
                <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full backdrop-blur-md border self-start ${
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
                     state.status === 'scanning' ? '监控中 (OCR)' : 
                     '待机'}
                  </span>
                </div>

                {/* Pending Alerts Indicator */}
                {!isNetworkOnline && pendingAlertCount > 0 && (
                  <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full backdrop-blur-md border bg-yellow-500/20 border-yellow-500 text-yellow-400 self-start">
                    <WifiOff className="w-3 h-3" />
                    <span className="text-xs font-bold">
                      {pendingAlertCount} 条报警待补发
                    </span>
                  </div>
                )}
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
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 h-full overflow-y-auto flex flex-col">
              <h3 className="text-lg font-bold mb-6 flex items-center space-x-2">
                <ShieldAlert className="w-5 h-5 text-emerald-400" />
                <span>报警设置</span>
              </h3>
              
              <div className="space-y-6 flex-grow">
                
                {/* Local Sound Setting */}
                <div className={`p-4 rounded-xl border transition-all ${settings.enableLocalSound ? 'bg-orange-900/20 border-orange-500/50' : 'bg-slate-700/30 border-slate-600'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-slate-300 uppercase flex items-center">
                      <Volume2 className="w-3 h-3 mr-2" /> 本地语音告警
                    </label>
                    <button 
                      onClick={() => playTTS("测试语音。游戏掉线了，请尽快重新登录。")}
                      className="text-[10px] bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white"
                      title="试听"
                    >
                      试听
                    </button>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => setSettings(s => ({...s, enableLocalSound: !s.enableLocalSound}))}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        settings.enableLocalSound ? 'bg-orange-500' : 'bg-slate-600'
                      }`}
                    >
                      <span
                        className={`${
                          settings.enableLocalSound ? 'translate-x-6' : 'translate-x-1'
                        } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                      />
                    </button>
                    <span className="text-xs text-slate-400">
                      {settings.enableLocalSound ? '已开启 (播报语音)' : '已关闭 (仅提示音)'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2">
                    开启后，掉线时将通过本机音响循环播放“游戏掉线了，请尽快重新登录”。
                  </p>
                </div>

                <div className="bg-indigo-900/20 p-4 rounded-xl border border-indigo-500/30">
                  <label className="block text-xs font-bold text-indigo-300 uppercase mb-2 flex items-center">
                    <MessageSquare className="w-3 h-3 mr-1" /> 喵提醒 喵码
                  </label>
                  <input 
                    type="password"
                    placeholder="例如: txxxxxx"
                    value={settings.meowCode}
                    onChange={(e) => setSettings({...settings, meowCode: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-white placeholder-slate-600"
                  />
                  <div className="mt-3 flex justify-between items-center">
                    <p className="text-[10px] text-slate-400">
                      用于微信报警 (miaotixing.com)
                    </p>
                    <button 
                      onClick={handleTestAlert}
                      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-lg flex items-center space-x-1 transition-colors"
                    >
                       <Send className="w-3 h-3" />
                       <span>测试发送</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">检测间隔 (秒)</label>
                  <input 
                    type="range" min="5" max="60" step="5"
                    value={settings.checkInterval}
                    onChange={(e) => setSettings({...settings, checkInterval: parseInt(e.target.value)})}
                    className="w-full accent-emerald-500"
                  />
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>5秒</span>
                    <span className="text-emerald-400 font-bold">{settings.checkInterval}秒</span>
                    <span>60秒</span>
                  </div>
                </div>

                {/* Debug Tool Section */}
                <div className="bg-slate-700/30 p-4 rounded-xl border border-slate-600 border-dashed">
                  <h4 className="text-xs font-bold text-slate-300 uppercase mb-3 flex items-center">
                    <Bug className="w-3 h-3 mr-2" /> OCR 诊断工具
                  </h4>
                  <p className="text-[10px] text-slate-400 mb-3">
                    上传掉线截图，测试 OCR 是否能准确识别关键字。
                  </p>
                  
                  <div className="flex flex-col space-y-3">
                    <label className="flex items-center justify-center px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg cursor-pointer border border-slate-600 transition-colors text-xs font-bold">
                      <Upload className="w-3 h-3 mr-2" />
                      {isTesting ? '正在识别...' : '上传图片测试'}
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handleFileUpload}
                        disabled={isTesting}
                      />
                    </label>

                    {testResult && (
                      <div className={`p-3 rounded-lg text-xs border ${testResult.isDisconnected ? 'bg-red-900/20 border-red-500/50' : 'bg-green-900/20 border-green-500/50'}`}>
                        <div className="flex items-center mb-1 font-bold">
                          {testResult.isDisconnected ? (
                            <CheckCircle2 className="w-4 h-4 text-red-400 mr-2" />
                          ) : (
                            <XCircle className="w-4 h-4 text-green-400 mr-2" />
                          )}
                          <span className={testResult.isDisconnected ? 'text-red-400' : 'text-green-400'}>
                            {testResult.isDisconnected ? '检测到掉线' : '未检测到掉线'}
                          </span>
                        </div>
                        <div className="mt-2 space-y-2">
                          <p className="text-slate-400">原因: <span className="text-slate-200">{testResult.reason}</span></p>
                          <p className="text-slate-400">原文: <span className="text-slate-200 font-mono bg-black/30 px-1 rounded break-all">{testResult.debugText || "无"}</span></p>
                          
                          {/* Display Processed Image */}
                          {testResult.processedImage && (
                             <div className="mt-2">
                               <p className="text-slate-500 text-[10px] mb-1 flex items-center">
                                 <Eye className="w-3 h-3 mr-1" /> 机器视角 (已裁切+二值化)
                               </p>
                               <img src={testResult.processedImage} alt="AI Vision" className="w-full border border-slate-600 rounded" />
                             </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full py-3 bg-emerald-600 rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/20 mt-4"
                >
                  保存并返回
                </button>
              </div>
            </div>
          ) : (
            /* Logs Section */
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 h-full flex flex-col">
              <h3 className="text-lg font-bold mb-4 flex items-center space-x-2">
                <History className="w-5 h-5 text-emerald-400" />
                <span>运行日志 (Local)</span>
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
                          'bg-emerald-500/20 text-emerald-400'
                        }`}>
                          {log.type === 'error' ? '掉线' : 
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
        <p>© 2024 GameWatch OCR - 本地离线识别模式。</p>
        <p className="mt-1 opacity-70">
          Created by 此去依然 | <a href="mailto:sam695781276@outlook.com" className="hover:text-emerald-400 transition-colors">sam695781276@outlook.com</a>
        </p>
      </footer>
    </div>
  );
};

export default App;