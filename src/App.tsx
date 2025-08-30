import React, { useEffect, useMemo, useRef, useState } from "react";
import { Lang, Translator, detect, translate } from "./translate";
import Home from "./Home";
import FriendList from "./FriendList";

type Role = "caller" | "answerer";

interface AppProps {
  forcedRole?: Role;
}
const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type Tab = "call" | "settings";

export default function App({ forcedRole, onBack }: AppProps & { onBack?: () => void } = {}) {
  const [page, setPage] = useState<'home'|'call'>('home');
  const [tab, setTab] = useState<Tab>("call");
  const [pc, setPc] = useState<RTCPeerConnection | null>(null);
  const [role, setRole] = useState<Role>(forcedRole ?? "caller");
  const localSDPRef = useRef<HTMLTextAreaElement>(null);
  const remoteSDPRef = useRef<HTMLTextAreaElement>(null);
  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  const [dcState, setDcState] = useState<"closed"|"connecting"|"open">("closed");
  const dcQueueRef = useRef<string[]>([]);

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
  // UI: 通話接続後に音声/字幕を表示するか（Caller/Answerから遷移した場合は最初は非表示）
  const [showMediaUI, setShowMediaUI] = useState<boolean>(forcedRole ? false : true);
  // UI: 接続設定を表示するか。Set Remote Description後は非表示にする（ただし機能は隠すだけ）
  const [showConnectionUI, setShowConnectionUI] = useState<boolean>(true);
  // UI: Call側の段階的表示制御
  const [showLocalSDP, setShowLocalSDP] = useState<boolean>(false);
  const [showRemoteSDP, setShowRemoteSDP] = useState<boolean>(false);
  // UI: Answerer側の段階的表示制御
  const [showAnswererRemoteSDP, setShowAnswererRemoteSDP] = useState<boolean>(false);
  const [showAnswererLocalSDP, setShowAnswererLocalSDP] = useState<boolean>(false);
  // Answerer側のLocal SDP値保存用
  const [answererLocalSDPValue, setAnswererLocalSDPValue] = useState<string>("");
  // Answerer側のRemote SDP入力値監視用
  const [answererRemoteSDPInput, setAnswererRemoteSDPInput] = useState<string>("");
  // カメラ表示の状態管理
  const [showCamera, setShowCamera] = useState<boolean>(false);
  // 通話時間管理
  const [callDuration, setCallDuration] = useState<number>(0);
  // FriendList画面の表示状態
  const [showFriendList, setShowFriendList] = useState<boolean>(false);

  // Translation / TTS
  const [fromLang, setFromLang] = useState<Lang>("auto");
  const [toLang, setToLang] = useState<Lang>("auto");
  const [translator, setTranslator] = useState<Translator>("mini-dict");
  const [speakOnReceive, setSpeakOnReceive] = useState(true);
  const [ttsLang, setTtsLang] = useState<"auto"|"ja"|"en">("auto");
  const [ttsVoiceName, setTtsVoiceName] = useState<string>("");
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const p = new RTCPeerConnection({ iceServers });
    setPc(p);
    p.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
      setIsInCall(true);
      showToast("相手の音声を受信しました");
    };
    p.onconnectionstatechange = () => {
      const newState = p.connectionState;
      setConnState(newState);
      if (newState === "connected") {
        setIsInCall(true);
        showToast("音声通話が接続されました");
      } else if (newState === "disconnected" || newState === "failed" || newState === "closed") {
        setIsInCall(false);
        showToast("音声通話が切断されました");
      }
    };
    p.oniceconnectionstatechange = () => {
      const newState = p.iceConnectionState;
      setIceState(newState);
      if (newState === "connected") {
        showToast("ICE接続が確立されました");
      } else if (newState === "failed" || newState === "disconnected") {
        showToast("ICE接続に問題が発生しました");
      }
    };
    p.ondatachannel = (ev) => wireDataChannel(ev.channel);
    return () => { p.close(); };
  }, []);

  // TTS voices init
  useEffect(() => {
    function loadVoices(){
      voicesRef.current = window.speechSynthesis.getVoices();
      if (!ttsVoiceName && voicesRef.current.length) {
        // pick Japanese if exists else first
        const ja = voicesRef.current.find(v => v.lang.toLowerCase().startsWith("ja"));
        const en = voicesRef.current.find(v => v.lang.toLowerCase().startsWith("en"));
        setTtsVoiceName((ja || en || voicesRef.current[0]).name);
      }
    }
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, [ttsVoiceName]);

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

  // 通話時間をフォーマットする関数
  const formatCallDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  function showToast(msg: string) { setToast(msg); setTimeout(()=>setToast(""), 1500); }

  function wireDataChannel(ch: RTCDataChannel) {
    setDataChannel(ch);
    setDcState(ch.readyState === "open" ? "open" : "connecting");
    ch.onopen = () => {
      setDcState("open");
      const q = dcQueueRef.current;
      while (q.length) {
        const txt = q.shift()!;
        try { ch.send(JSON.stringify({ type: "caption", text: txt })); } catch {}
      }
      showToast("DataChannel open");
    };
    ch.onclose = () => { setDcState("closed"); showToast("DataChannel closed"); };
    ch.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "caption") {
          setCaptions((old) => [...old.slice(-50), msg.text]);
          if (speakOnReceive) speak(msg.text);
        } else if (msg.type === "show_media_ui") {
          // 相手からの通知でメディアUIを表示し、接続設定を隠す
          setShowMediaUI(true);
          setShowConnectionUI(false);
          showToast("相手が通話を開始しました");
        }
      } catch {}
    };
  }

  // Media
  async function startMic() {
    if (!pc) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      localStreamRef.current = stream;
      
      // 既存のオーディオトラックを削除
      for (const sender of pc.getSenders()) {
        if (sender.track && sender.track.kind === "audio") {
          pc.removeTrack(sender);
        }
      }
      
      // 新しいオーディオトラックを追加
      stream.getAudioTracks().forEach(track => {
        pc.addTrack(track, stream);
      });
      
      setMicEnabled(true); 
      setMicMuted(false);
      
      // Call側の場合、Local SDPを表示
      if (role === "caller") {
        setShowLocalSDP(true);
      }
      // Answerer側の場合、Remote SDPを表示
      if (role === "answerer") {
        setShowAnswererRemoteSDP(true);
      }
      
      showToast("マイクが開始されました");
      
      // 音声トラックを追加した後、接続が確立されている場合は再ネゴシエーションが必要
      if (pc.connectionState === "connected" || pc.connectionState === "connecting") {
        showToast("音声トラックが追加されました。必要に応じてSDPを再交換してください。");
      }
    } catch (error) {
      console.error("マイクの開始に失敗しました:", error);
      showToast("マイクの開始に失敗しました");
    }
  }
  
  function stopMic() {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    // オーディオトラックを削除
    if (pc) {
      for (const sender of pc.getSenders()) {
        if (sender.track && sender.track.kind === "audio") {
          pc.removeTrack(sender);
        }
      }
    }
    
    setMicEnabled(false); 
    setMicMuted(false);
    showToast("マイクが停止されました");
  }

  function endCall() {
    if (pc) {
      pc.close();
      setPc(null);
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    setMicEnabled(false);
    setMicMuted(false);
    setIsInCall(false);
    setConnState("new");
    setIceState("new");
    setDcState("closed");
    setDataChannel(null);
    showToast("通話が終了されました");
  }

  function createNewConnection() {
    endCall();
    const p = new RTCPeerConnection({ iceServers });
    setPc(p);
    p.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
      setIsInCall(true);
      showToast("相手の音声を受信しました");
    };
    p.onconnectionstatechange = () => {
      const newState = p.connectionState;
      setConnState(newState);
      if (newState === "connected") {
        setIsInCall(true);
        showToast("音声通話が接続されました");
      } else if (newState === "disconnected" || newState === "failed" || newState === "closed") {
        setIsInCall(false);
        showToast("音声通話が切断されました");
      }
    };
    p.oniceconnectionstatechange = () => {
      const newState = p.iceConnectionState;
      setIceState(newState);
      if (newState === "connected") {
        showToast("ICE接続が確立されました");
      } else if (newState === "failed" || newState === "disconnected") {
        showToast("ICE接続に問題が発生しました");
      }
    };
    p.ondatachannel = (ev) => wireDataChannel(ev.channel);
    
    // 既存のローカルストリームがある場合は、新しい接続にも追加
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        p.addTrack(track, localStreamRef.current!);
      });
      showToast("既存の音声トラックが新しい接続に追加されました");
    }
    
    showToast("新しい接続が作成されました");
  }
  
  function toggleMute() {
    const stream = localStreamRef.current;
    if (!stream) return;
    
    const to = !micMuted;
    stream.getAudioTracks().forEach(track => {
      track.enabled = !to;
    });
    setMicMuted(to);
    showToast(to ? "マイクがミュートされました" : "マイクのミュートが解除されました");
  }

  // Manual signaling
  async function createOffer() {
    if (!pc) return;
    setCreatingOffer(true);
    try {
      // 音声トラックが追加されているか確認
      if (!localStreamRef.current) {
        showToast("先にマイクを開始してください");
        return;
      }
      
      const ch = pc.createDataChannel("captions");
      wireDataChannel(ch);
      
      // 音声トラックが確実に含まれるようにする
      const audioTracks = localStreamRef.current.getAudioTracks();
      if (audioTracks.length === 0) {
        showToast("音声トラックが見つかりません");
        return;
      }
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForICEGathering(pc);
      localSDPRef.current!.value = JSON.stringify(pc.localDescription);
      
      // Create Offer後、Remote SDPを表示
      setShowRemoteSDP(true);
      
      showToast("Offer created - 音声トラックが含まれています");
    } finally { setCreatingOffer(false); }
  }
  
  async function acceptOfferAndCreateAnswer() {
    if (!pc || !remoteSDPRef.current) return;
    setAnswering(true);
    try {
      const offer = JSON.parse(remoteSDPRef.current.value);
      await pc.setRemoteDescription(offer);
      
      // 音声トラックが追加されているか確認
      if (!localStreamRef.current) {
        showToast("先にマイクを開始してください");
        return;
      }
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForICEGathering(pc);
      
      // Answerer側の場合、Local SDPを表示してから値を設定
      if (role === "answerer") {
        setAnswererLocalSDPValue(JSON.stringify(pc.localDescription));
        setShowAnswererLocalSDP(true);
      } else {
        // Caller側の場合は従来通り
        if (localSDPRef.current) {
          localSDPRef.current.value = JSON.stringify(pc.localDescription);
        }
      }
      
      showToast("Answer created - 音声トラックが含まれています");
    } finally { setAnswering(false); }
  }
  async function setRemoteDescriptionManual() {
    if (!pc || !remoteSDPRef.current) return;
    setSettingRemote(true);
    try {
      const remote = JSON.parse(remoteSDPRef.current.value);
  await pc.setRemoteDescription(remote);
  showToast("Remote description set");
  // ユーザー要望: Set Remote Description の後に接続設定を隠して
  // 音声・字幕を表示する（ただし機能はDOMに残す）
      setShowMediaUI(true);
      setShowConnectionUI(false);
      // dataChannel が開いていれば相手にも UI 切替を通知
      try {
        if (dataChannel && dataChannel.readyState === 'open') {
          dataChannel.send(JSON.stringify({ type: 'show_media_ui' }));
        }
      } catch {}
    } finally { setSettingRemote(false); }
  }

  async function sendCaption() {
    console.log('sendCaption called, dataChannel:', dataChannel);
    if (!dataChannel) {
      console.log('No dataChannel, returning');
      return;
    }
    if (sendingCaption) {
      console.log('Already sending, returning');
      return;
    }
    setSendingCaption(true);
    let text = sendText.trim(); 
    if (!text) { 
      console.log('No text to send, returning');
      setSendingCaption(false); 
      return; 
    }
    console.log('Sending text:', text);
    setSendText("");
    const src = fromLang === "auto" ? detect(text) : fromLang;
    const tgt = toLang === "auto" ? src : toLang;
    console.log('Translation: from', src, 'to', tgt);
    const outText = await translate(text, src, tgt, translator);
    console.log('Translated text:', outText);
    if (dataChannel.readyState !== "open") {
      console.log('DataChannel not open, queueing');
      dcQueueRef.current.push(outText);
      showToast("DataChannel not open — queued");
      setSendingCaption(false);
      return;
    }
    console.log('Sending to DataChannel');
    dataChannel.send(JSON.stringify({ type: "caption", text: outText }));
    setCaptions((old) => [...old.slice(-50), "(you) " + outText]);
    setSendingCaption(false);
    console.log('Send complete');
  }

  function speak(text: string) {
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
  }

  const voices = voicesRef.current;
  const voiceOptions = useMemo(() => voices.map(v => ({ name: v.name, lang: v.lang })), [voices]);

  // ヘッダータイトル：role / forcedRole に応じて表示を変更
  const headerTitle = (() => {
    if (page === 'home') return 'Nois WebRTC';
    const r = forcedRole ?? role;
    if (r === 'caller') return 'Call';
    if (r === 'answerer') return 'Reception';
    return 'Nois WebRTC';
  })();

  if (page === 'home') {
    // forcedRoleがある場合は直接call画面に遷移
    if (forcedRole) {
      setPage('call');
      // ページ遷移後にレンダリングを止める
      return null;
    }
    return <Home 
      onCall={() => setPage('call')} 
      onReception={() => {
        // 受信ボタン押下時にAnswerer画面へ遷移（ただし通常Appでは未使用）
        setRole('answerer');
        setPage('call');
      }}
      onFriendList={() => setShowFriendList(true)}
    />;
  }

  if (showFriendList) {
    return <FriendList onBack={() => setShowFriendList(false)} />;
  }

  return (
    <div className={`min-h-screen ${page==='call' ? 'bg-white' : 'bg-gradient-to-br from-slate-100 to-slate-200'} p-2 md:p-4 overflow-hidden relative`}>
      {/* 背景画像 - CallとReception画面にのみ表示 */}
      {page === 'call' && (
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
      )}
      {/* Call/Recepton は背景を白にしてコンテンツと分離しない */}
      <div className={`h-full flex flex-col relative z-10 ${page==='call' ? 'mx-0 w-full' : 'mx-auto max-w-5xl rounded-2xl shadow-2xl bg-white/80 backdrop-blur-md border border-slate-200'}`}>
        {toast && <div className="fixed top-4 right-4 z-50 rounded-xl bg-black/90 text-white px-4 py-2 text-base shadow-2xl font-semibold tracking-wide animate-fadein">{toast}</div>}

        <header className={`flex items-center justify-between pb-2 border-b border-slate-200 bg-white/70 ${page==='call' ? '' : 'rounded-t-2xl'}`}>
          <div className="flex items-center">
            {onBack && (
              <button onClick={onBack} className="flex items-center justify-center w-10 h-14 hover:opacity-80 transition-opacity cursor-pointer">
                <img src="/back-icon.png" alt="戻る" className="w-full h-full object-contain" />
              </button>
            )}
          <div className="home-font text-3xl font-extrabold pr-1 bg-gradient-to-r from-sky-400 to-slate-500 bg-clip-text text-transparent drop-shadow-sm select-none" style={{letterSpacing:'-1px'}}>{headerTitle}</div>
          </div>
          <div className="flex gap-2 items-center">
            {page === 'call' && (
              <button onClick={() => setTab("settings")} className="flex items-center justify-center w-6 h-6 hover:opacity-80 transition-opacity cursor-pointer">
                <img src="/icon-settings.png" alt="設定" className="w-full h-full object-contain" />
              </button>
            )}
          </div>
        </header>

        {tab === "call" ? (
          <div className={`flex-1 flex flex-col lg:flex-row overflow-hidden bg-white pb-24 ${ (showConnectionUI && showMediaUI) ? 'gap-3 p-3' : 'gap-0 p-0' }`}>
            {/* 左側：接続設定 */}
            <div className={`flex-shrink-0 ${showConnectionUI ? (showMediaUI ? 'w-full lg:w-1/2' : 'w-full lg:w-full') : 'w-0 lg:w-0'} space-y-3 transition-all ${showConnectionUI ? '' : 'opacity-0 pointer-events-none max-h-0 overflow-hidden'}`}>
              <div>
                <div className={`${micEnabled ? 'flex flex-wrap items-center gap-2' : 'flex justify-center'} mt-2 mb-3`}>
                  <button onClick={micEnabled?stopMic:startMic} className={"px-3 py-2 text-white text-lg font-medium border rounded " + (micEnabled ? "bg-red-600 border-red-600" : "bg-blue-600 border-blue-600")}>
                    {micEnabled ? "Call Stop" : "Call Start "}
                  </button>
                </div>

                {micEnabled && (
                  <>
                    {isInCall && role === "caller" && (
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <button onClick={endCall} className="px-3 py-2 text-white text-sm font-medium border rounded bg-red-700 border-red-700">
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
                              ref={localSDPRef} 
                              className="w-full h-16 border border-gray-300 p-2 text-sm font-mono bg-gray-50" 
                              readOnly 
                              placeholder="Tap 'Create' to generate an authentication code and send it to the other person."
                            />
                      <button
                        onClick={async ()=>{ try{ await navigator.clipboard.writeText(localSDPRef.current?.value||""); setCopiedLocal(true); showToast("Local SDP copied"); setTimeout(()=>setCopiedLocal(false),1200);}catch{} }}
                        className={"absolute top-2 right-2 px-2 py-1 text-white text-sm border " + (copiedLocal ? "bg-green-600 border-green-600" : "bg-gray-600 border-gray-600")}
                      >{copiedLocal?"Copied!":"Copy"}</button>
                    </div>
                          <div className="flex justify-center mt-2">
                            <button onClick={createOffer} disabled={creatingOffer} className={"px-6 py-2 text-white text-lg font-medium border rounded min-w-32 " + (creatingOffer ? "bg-indigo-400 border-indigo-400 cursor-not-allowed" : "bg-indigo-600 border-indigo-600")}>
                              {creatingOffer ? "Creating..." : "Create"}
                            </button>
                          </div>
                  </div>
                      )}
                      
                      {/* Remote SDP - Call側のみ段階的に表示 */}
                      {role === "caller" && showRemoteSDP && (
                  <div>
                          <h3 className="font-medium text-gray-700 mb-2 text-sm">Paste Pairing Code</h3>
                          <textarea ref={remoteSDPRef} className="w-full h-16 border border-gray-300 p-2 text-sm font-mono bg-gray-50" placeholder="Paste the pairing code here." />
                          <div className="flex justify-center mt-2">
                            <button onClick={setRemoteDescriptionManual} disabled={settingRemote} className={"px-6 py-2 text-white text-lg font-medium border rounded min-w-32 " + (settingRemote ? "bg-indigo-400 border-indigo-400 cursor-not-allowed" : "bg-indigo-600 border-indigo-600")}>
                              {settingRemote ? "Setting..." : "Start a call"}
                        </button>
                          </div>
                        </div>
                      )}
                      
                                              {/* Answerer側のRemote SDP表示（段階的に表示） */}
                        {role === "answerer" && showAnswererRemoteSDP && (
                          <div>
                            <h3 className="font-medium text-gray-700 mb-2 text-sm">Paste Pairing Code</h3>
                            <textarea 
                              ref={remoteSDPRef} 
                              value={answererRemoteSDPInput}
                              onChange={(e) => setAnswererRemoteSDPInput(e.target.value)}
                              className="w-full h-16 border border-gray-300 p-2 text-sm font-mono bg-gray-50" 
                              placeholder="※Paste the pairing code here." 
                            />
                            {answererRemoteSDPInput.trim() && (
                              <div className="flex justify-center mt-2">
                                <button onClick={acceptOfferAndCreateAnswer} disabled={answering} className={"px-6 py-2 text-white text-lg font-medium border rounded min-w-32 " + (answering ? "bg-indigo-400 border-indigo-400 cursor-not-allowed" : "bg-indigo-600 border-indigo-600")}>
                                  {answering ? "Answering..." : "Create"}
                      </button>
                              </div>
                            )}
                          
                          {/* Answerer側のLocal SDP表示（Remote SDPの下に配置） */}
                          {showAnswererLocalSDP && (
                            <div className="mt-4">
                              <h3 className="font-medium text-gray-700 mb-2 text-sm">Pairing Code</h3>
                              <div className="relative">
                                <textarea 
                                  value={answererLocalSDPValue}
                                  className="w-full h-16 border border-gray-300 p-2 text-sm font-mono bg-gray-50"  
                                  readOnly 
                                />
                                <button
                                  onClick={async ()=>{ try{ await navigator.clipboard.writeText(answererLocalSDPValue); setCopiedLocal(true); showToast("Local SDP copied"); setTimeout(()=>setCopiedLocal(false),1200);}catch{} }}
                                  className={"absolute top-2 right-2 px-2 py-1 text-white text-sm border " + (copiedLocal ? "bg-green-600 border-green-600" : "bg-gray-600 border-gray-600")}
                                >{copiedLocal?"Copied!":"Copy"}</button>
                              </div>
                              <div className="flex justify-center mt-2">
                                <button onClick={setRemoteDescriptionManual} disabled={settingRemote} className={"px-6 py-2 text-white text-lg font-medium border rounded min-w-32 " + (settingRemote ? "bg-indigo-400 border-indigo-400 cursor-not-allowed" : "bg-indigo-600 border-indigo-600")}>
                                  {settingRemote ? "Setting..." : "Start a call"}
                      </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* forcedRoleがない場合のみロール切替UIを表示 */}
                      {!forcedRole && (
                        <div className="flex items-center gap-2 ml-auto">
                          <label className="text-sm font-medium text-gray-700">Role:</label>
                          <select className="border border-gray-300 px-2 py-1 text-sm bg-white" value={role} onChange={(e)=>setRole(e.target.value as Role)}>
                            <option value="caller">Caller</option>
                            <option value="answerer">Answerer</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 右側：音声と字幕 */}
            <div className={`${showMediaUI ? 'w-full lg:w-full' : 'w-0 lg:w-0'} flex-1 flex flex-col space-y-3 transition-all ${showMediaUI ? '' : 'opacity-0 pointer-events-none max-h-0 overflow-hidden'}`}>
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
                      onClick={() => setMicMuted(!micMuted)}
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
                  
                  {/* Talk */}
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
                    <button onClick={() => { console.log('Button clicked, sendText:', sendText); sendCaption(); }} disabled={sendingCaption}>
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
                      <select className="border border-gray-300 px-2 py-1 text-sm bg-white" value={ttsLang} onChange={(e)=>setTtsLang(e.target.value as any)}>
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
      </div>
      
      {/* ナビゲーションバー（フッター） */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around items-center h-16 z-20">
        <button className="flex flex-col items-center"><img src="/home.png" alt="home" className="w-7 h-7 object-contain" /></button>
        <button className="flex flex-col items-center"><img src="/discover-icon.png" alt="discover" className="w-7 h-7 object-contain" /></button>
        <div className="flex flex-col items-center justify-center">
          <img src="/logo.png" alt="logo" className="w-10 h-10 object-contain" style={{marginTop: '-2px'}} />
        </div>
        <button className="flex flex-col items-center"><img src="/icon_beru.png" alt="bell" className="w-7 h-7 object-contain" /></button>
        <button className="flex flex-col items-center"><img src="/icon-settings.png" alt="settings" className="w-7 h-7 object-contain" /></button>
      </nav>
    </div>
  );
}

async function waitForICEGathering(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    function check(){ if (pc.iceGatheringState === "complete") { pc.removeEventListener("icegatheringstatechange", check); resolve(); } }
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(check, 2000);
  });
}
