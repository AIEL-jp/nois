import React, { useEffect, useMemo, useRef, useState } from "react";
import { Lang, Translator, detect, translate } from "./translate";

type Role = "caller" | "answerer";

export default function FriendList({ onBack }: { onBack: () => void }) {
  // App.tsxと同じ状態変数とロジックを使用
  const [page, setPage] = useState<'call'>('call');
  const [tab, setTab] = useState<"call" | "settings">("call");
  const [role, setRole] = useState<Role>("caller");
  
  // WebRTC
  const [pc, setPc] = useState<RTCPeerConnection | null>(null);
  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  const [dcQueueRef] = useState<{ current: string[] }>({ current: [] });
  const [dcState, setDcState] = useState<RTCDataChannelState | "new">("new");

  // Captions
  const [captions, setCaptions] = useState<string[]>([]);
  const [sendText, setSendText] = useState("");

  // Audio
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);

  // States / UX
  const [toast, setToast] = useState<string>("");
  const [creatingOffer, setCreatingOffer] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [settingRemote, setSettingRemote] = useState(false);
  const [sendingCaption, setSendingCaption] = useState(false);
  const [copiedLocal, setCopiedLocal] = useState(false);
  const [connState, setConnState] = useState<RTCPeerConnectionState | "new">("new");
  const [iceState, setIceState] = useState<RTCIceConnectionState | "new">("new");
  const [isInCall, setIsInCall] = useState(false);
  const [showMediaUI, setShowMediaUI] = useState<boolean>(false);
  const [showConnectionUI, setShowConnectionUI] = useState<boolean>(true);
  const [showLocalSDP, setShowLocalSDP] = useState<boolean>(false);
  const [showRemoteSDP, setShowRemoteSDP] = useState<boolean>(false);
  const [showAnswererRemoteSDP, setShowAnswererRemoteSDP] = useState<boolean>(false);
  const [showAnswererLocalSDP, setShowAnswererLocalSDP] = useState<boolean>(false);
  const [answererLocalSDPValue, setAnswererLocalSDPValue] = useState<string>("");
  const [answererRemoteSDPInput, setAnswererRemoteSDPInput] = useState<string>("");
  const [showCamera, setShowCamera] = useState<boolean>(false);
  const [callDuration, setCallDuration] = useState<number>(0);

  // Translation / TTS
  const [fromLang, setFromLang] = useState<Lang>("auto");
  const [toLang, setToLang] = useState<Lang>("auto");
  const [translator, setTranslator] = useState<Translator>("mini-dict");
  const [speakOnReceive, setSpeakOnReceive] = useState(true);
  const [ttsLang, setTtsLang] = useState<"auto"|"ja"|"en">("auto");
  const [ttsVoiceName, setTtsVoiceName] = useState<string>("");
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  // ICE servers
  const iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ];

  // ヘッダータイトル
  const headerTitle = "Friend List";

  // 通話時間の更新
  useEffect(() => {
    let interval: number;
    if (isInCall) {
      interval = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isInCall]);

  // 通話時間のフォーマット
  const formatCallDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // トースト表示
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 3000);
  };

  // マイクの開始/停止
  const startMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setMicEnabled(true);
      showToast("マイクが有効になりました");
    } catch (error) {
      showToast("マイクの取得に失敗しました");
    }
  };

  const stopMic = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    setMicEnabled(false);
    showToast("マイクが無効になりました");
  };

  // ミュートの切り替え
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMicMuted(!audioTrack.enabled);
        showToast(audioTrack.enabled ? "ミュートが解除されました" : "ミュートされました");
      }
    }
  };

  // 字幕の送信
  const sendCaption = async () => {
    if (!dataChannel) return;
    if (sendingCaption) return;
    setSendingCaption(true);
    let text = sendText.trim(); 
    if (!text) { 
      setSendingCaption(false); 
      return; 
    }
    setSendText("");
    const src = fromLang === "auto" ? detect(text) : fromLang;
    const tgt = toLang === "auto" ? src : toLang;
    const outText = await translate(text, src, tgt, translator);
    if (dataChannel.readyState !== "open") {
      dcQueueRef.current.push(outText);
      showToast("DataChannel not open — queued");
      setSendingCaption(false);
      return;
    }
    dataChannel.send(JSON.stringify({ type: "caption", text: outText }));
    setCaptions((old) => [...old.slice(-50), "(you) " + outText]);
    setSendingCaption(false);
  };

  // TTS
  const speak = (text: string) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      const chooseLang = ttsLang === "auto" ? (/[\u3040-\u30ff\u3400-\u9fff]/.test(text) ? "ja" : "en") : ttsLang;
      u.lang = chooseLang === "ja" ? "ja-JP" : "en-US";
      const voices = voicesRef.current;
      const preferred = voices.find(v => v.name === ttsVoiceName) || voices.find(v => v.lang.toLowerCase().startsWith(u.lang.toLowerCase())) || voices[0];
      if (preferred) u.voice = preferred;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {}
  };

  // TTS voices init
  useEffect(() => {
    function loadVoices(){
      voicesRef.current = window.speechSynthesis.getVoices();
      if (!ttsVoiceName && voicesRef.current.length) {
        const ja = voicesRef.current.find(v => v.lang.toLowerCase().startsWith("ja"));
        const en = voicesRef.current.find(v => v.lang.toLowerCase().startsWith("en"));
        setTtsVoiceName((ja || en || voicesRef.current[0]).name);
      }
    }
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, [ttsVoiceName]);

  const voices = voicesRef.current;
  const voiceOptions = useMemo(() => voices.map(v => ({ name: v.name, lang: v.lang })), [voices]);

  return (
    <div className="min-h-screen bg-white p-2 md:p-4 overflow-hidden relative">
      {/* 背景画像 */}
      <div 
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: 'url(/nois-background.png)',
          backgroundSize: 'contain',
          backgroundPosition: 'right top',
          backgroundRepeat: 'no-repeat',
          opacity: 0.1,
          top: '220px'
        }}
      />

      {/* ヘッダー */}
      <header className="flex items-center justify-between pb-2 border-b border-slate-200 bg-white/70 relative z-10">
        <div className="flex items-center">
          <button onClick={onBack} className="flex items-center justify-center w-10 h-14 hover:opacity-80 transition-opacity cursor-pointer">
            <img src="/back-icon.png" alt="戻る" className="w-full h-full object-contain" />
          </button>
          <div className="home-font text-3xl font-extrabold pr-1 bg-gradient-to-r from-sky-400 to-slate-500 bg-clip-text text-transparent drop-shadow-sm select-none" style={{letterSpacing:'-1px'}}>{headerTitle}</div>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={() => setTab("settings")} className="flex items-center justify-center w-6 h-6 hover:opacity-80 transition-opacity cursor-pointer">
            <img src="/icon-settings.png" alt="設定" className="w-full h-full object-contain" />
          </button>
        </div>
      </header>

      {toast && <div className="fixed top-4 right-4 z-50 rounded-xl bg-black/90 text-white px-4 py-2 text-base shadow-2xl font-semibold tracking-wide animate-fadein">{toast}</div>}

      {tab === "call" ? (
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-white pb-24 gap-3 p-3 relative z-10">
          {/* 左側：接続設定 */}
          <div className="flex-shrink-0 w-full lg:w-1/2 space-y-3">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button onClick={micEnabled?stopMic:startMic} className={"px-3 py-2 text-white text-sm font-medium border rounded " + (micEnabled ? "bg-red-600 border-red-600" : "bg-blue-600 border-blue-600")}>
                  {micEnabled ? "Call Stop" : "Call Start "}
                </button>
              </div>

              {micEnabled && (
                <>
                  {isInCall && role === "caller" && (
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <button className="px-3 py-2 text-white text-sm font-medium border rounded bg-red-700 border-red-700">
                        通話終了
                      </button>
                      <div className="text-sm text-green-600 bg-green-50 px-2 py-1 border border-green-300 font-medium">
                        🎤 通話中
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    {/* Local SDP - Call側のみ段階的に表示 */}
                    {role === "caller" && showLocalSDP && (
                      <div>
                        <h3 className="font-medium text-gray-700 mb-2 text-sm">Pairing Code</h3>
                        <div className="relative">
                          <textarea 
                            className="w-full h-16 border border-gray-300 p-2 text-sm font-mono bg-gray-50" 
                            readOnly 
                            placeholder="Tap 'Create' to generate an authentication code and send it to the other person."
                          />
                          <button className="absolute top-2 right-2 px-2 py-1 text-white text-sm border bg-gray-600 border-gray-600">
                            Copy
                          </button>
                        </div>
                        <div className="flex justify-center mt-2">
                          <button className="px-6 py-2 text-white text-lg font-medium border rounded min-w-32 bg-indigo-600 border-indigo-600">
                            Create
                          </button>
                        </div>
                      </div>
                    )}
                    
                    {/* Remote SDP - Call側のみ段階的に表示 */}
                    {role === "caller" && showRemoteSDP && (
                      <div>
                        <h3 className="font-medium text-gray-700 mb-2 text-sm">Paste Pairing Code</h3>
                        <textarea className="w-full h-16 border border-gray-300 p-2 text-sm font-mono bg-gray-50" placeholder="Paste the pairing code here." />
                        <div className="flex justify-center mt-2">
                          <button className="px-6 py-2 text-white text-lg font-medium border rounded min-w-32 bg-indigo-600 border-indigo-600">
                            Start a call
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 右側：音声と字幕 */}
          <div className="flex-1 flex flex-col space-y-3">
            {/* カメラ表示エリア */}
            <div>
              {/* 上部のIndigo長方形 */}
              <div className="w-full h-8 bg-indigo-800 flex items-center px-4">
                {isInCall && (
                  <div className="text-white text-sm font-medium">
                    {formatCallDuration(callDuration)}
                  </div>
                )}
              </div>
              
              {/* カメラ表示エリア */}
              <div className="w-full h-64 bg-gray-600 flex items-center justify-center relative">
                {!showCamera ? (
                  <div className="text-center flex flex-col items-center justify-center">
                    <img src="/notcamera.png" alt="camera off" className="w-16 h-16" />
                    <div className="text-lg text-gray-600">Your camera is off.</div>
                  </div>
                ) : (
                  <div className="w-full h-full">
                    {/* カメラがオンの場合は何も表示しない */}
                  </div>
                )}
              </div>
              
              {/* 下部のIndigo長方形 */}
              <div className="w-full h-16 bg-indigo-800 flex items-center justify-around px-4">
                {/* Microphone */}
                <div className="flex flex-col items-center">
                  <button
                    onClick={() => toggleMute()}
                    className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                    style={{
                      backgroundColor: micMuted ? '#dc2626' : '#1e1b4b'
                    }}
                  >
                    <img 
                      src={micMuted ? "/notmic-icon.png" : "/mic-icon.png"} 
                      alt="microphone" 
                      className="w-9 h-7 object-contain" 
                    />
                  </button>
                  <span className="text-white text-[10px] mt-1 text-center leading-tight">Microphone</span>
                </div>
                
                {/* Camera */}
                <div className="flex flex-col items-center">
                  <button
                    onClick={() => setShowCamera(!showCamera)}
                    className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                    style={{
                      backgroundColor: showCamera ? '#dc2626' : '#1e1b4b'
                    }}
                  >
                    <img 
                      src={showCamera ? "/notcamera.png" : "/camera.png"} 
                      alt="camera" 
                      className="w-6 h-6 object-contain" 
                    />
                  </button>
                  <span className="text-white text-[10px] mt-1 text-center leading-tight">Camera</span>
                </div>
                
                {/* End Call */}
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center">
                    <img src="/phone-icon.png" alt="end call" className="w-10 h-10 object-contain" />
                  </div>
                </div>
                
                {/* Switch Camera */}
                <div className="flex flex-col items-center">
                  <div className="w-7 h-7 bg-indigo-900 rounded-full flex items-center justify-center">
                    <img src="/switch-icon.png" alt="switch camera" className="w-5 h-5 object-contain" />
                  </div>
                  <span className="text-white text-[10px] mt-1 text-center leading-tight">Switch Camera</span>
                </div>
                
                {/* Speaker */}
                <div className="flex flex-col items-center">
                  <button
                    onClick={() => setSpeakerOn(!speakerOn)}
                    className="w-7 h-7 bg-indigo-900 rounded-full flex items-center justify-center transition-colors"
                  >
                    <img 
                      src={speakerOn ? "/onspeaker.png" : "/offspeaker.png"} 
                      alt="speaker" 
                      className="w-8 h-5 object-contain" 
                    />
                  </button>
                  <span className="text-white text-[10px] mt-1 text-center leading-tight">Speaker</span>
                </div>
              </div>
            </div>

            <div>
              <audio ref={remoteAudioRef} autoPlay playsInline className="w-full" />
            </div>

            <div className="flex-1 overflow-hidden">
              <div className="h-64 overflow-auto border border-gray-300 p-3 bg-gray-50 mb-3">
                <div className="space-y-3">
                  {captions.map((c,i) => {
                    const isOwnMessage = c.startsWith("(you) ");
                    const messageText = isOwnMessage ? c.replace("(you) ", "") : c;
                    return (
                      <div key={i} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-xs px-3 py-2 rounded-2xl ${
                          isOwnMessage 
                            ? 'bg-white text-gray-800 shadow-sm border border-gray-200' 
                            : 'bg-gray-800 text-white shadow-sm'
                        }`}>
                          <span className="text-sm">{messageText}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input 
                  className={`border border-gray-300 px-2 py-2 bg-white rounded-full transition-all duration-300 ${sendText.trim() ? 'flex-1 min-w-0' : 'w-full'}`} 
                  value={sendText} 
                  onChange={(e)=>setSendText(e.target.value)} 
                  onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendCaption(); }}} 
                  placeholder="Enter your message..."
                />
                {sendText.trim() && (
                  <button onClick={sendCaption} disabled={sendingCaption}>
                    {sendingCaption ? (
                      <span className="text-gray-500 text-sm">...</span>
                    ) : (
                      <img src="/send-icon.png" alt="send" className="w-16 h-10 object-contain" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto bg-gray-100 p-3">
          <div className="bg-white border border-gray-300 p-4">
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-gray-800 pb-2 border-b border-gray-300">設定</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">翻訳（送信前処理）</label>
                  <div className="flex items-center gap-2">
                    <select className="border border-gray-300 px-2 py-1 text-sm bg-white" value={fromLang} onChange={(e)=>setFromLang(e.target.value as Lang)}>
                      <option value="auto">Auto</option><option value="ja">JA</option><option value="en">EN</option>
                    </select>
                    <span className="text-gray-500">→</span>
                    <select className="border border-gray-300 px-2 py-1 text-sm bg-white" value={toLang} onChange={(e)=>setToLang(e.target.value as Lang)}>
                      <option value="auto">Auto</option><option value="ja">JA</option><option value="en">EN</option>
                    </select>
                    <select className="border border-gray-300 px-2 py-1 text-sm bg-white" value={translator} onChange={(e)=>setTranslator(e.target.value as any)}>
                      <option value="mini-dict">MiniDict</option><option value="mock-tag">Mock</option><option value="none">None</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">受信テキストの読み上げ（TTS）</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={speakOnReceive} onChange={(e)=>setSpeakOnReceive(e.target.checked)} />
                      <span>有効にする</span>
                    </label>
                    <select className="border border-gray-300 px-2 py-1 text-sm bg-white" value={ttsLang} onChange={(e)=>setTtsLang(e.target.value as Lang)}>
                      <option value="auto">Lang: Auto</option>
                      <option value="ja">Lang: JA</option>
                      <option value="en">Lang: EN</option>
                    </select>
                    <select className="border border-gray-300 px-2 py-1 text-sm bg-white" value={ttsVoiceName} onChange={(e)=>setTtsVoiceName(e.target.value)}>
                      {voiceOptions.map(v => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={()=>{ const sample = ttsLang==="ja"?"テスト。こんにちは。":"Test: Hello there."; speak(sample); }} className="px-3 py-2 bg-gray-600 text-white text-sm font-medium border rounded border-gray-600">TTS Test</button>
                  </div>
                </div>
              </div>

              <div className="text-sm text-gray-600 bg-gray-50 px-3 py-2 border border-gray-300">
                注意: ブラウザの自動再生制限により、初回はボタン操作後でないと音声が再生されない場合があります。
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* ナビゲーションバー（フッター） */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around items-center h-16 z-20">
        <button className="flex flex-col items-center"><img src="/home.png" alt="home" className="w-7 h-7 object-contain" /></button>
        <button className="flex flex-col items-center"><img src="/discover-icon.png" alt="discover" className="w-7 h-7 object-contain" /></button>
        <div className="flex flex-col items-center justify-center">
          <img src="/logo.png" alt="logo" className="w-10 h-10 object-contain" style={{marginTop: '-2px'}} />
        </div>
        <button className="flex flex-col items-center"><img src="/icon_beru.png" alt="bell" className="w-7 h-7 object-contain" /></button>
        <button className="flex flex-col items-center"><img src="/icon-settings.png" alt="settings" className="w-7 h-10 object-contain" /></button>
      </nav>
    </div>
  );
}
