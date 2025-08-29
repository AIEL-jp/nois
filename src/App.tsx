import React, { useEffect, useMemo, useRef, useState } from "react";
import { Lang, Translator, detect, translate } from "./translate";
import Home from "./Home";

type Role = "caller" | "answerer";

interface AppProps {
  forcedRole?: Role;
  roleLabel?: string;
  roleDescription?: string;
  roleColor?: string;
}
const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type Tab = "call" | "settings";

export default function App({ forcedRole, onBack, roleLabel, roleDescription, roleColor }: AppProps & { onBack?: () => void } = {}) {
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
  // UI: 通話画面を表示するフラグ（Create Answer の直後は true にしない）
  const [uiCallStarted, setUiCallStarted] = useState(false);

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
  setUiCallStarted(true);
        showToast("音声通話が接続されました");
      } else if (newState === "disconnected" || newState === "failed" || newState === "closed") {
        setIsInCall(false);
  setUiCallStarted(false);
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
  setUiCallStarted(false);
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
  localSDPRef.current!.value = JSON.stringify(pc.localDescription);
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
  // ユーザーが明示的に Remote Description をセットしたときに UI を通話画面へ切替
  setUiCallStarted(true);
    } finally { setSettingRemote(false); }
  }

  async function sendCaption() {
    if (!dataChannel) return;
    if (sendingCaption) return;
    setSendingCaption(true);
    let text = sendText.trim(); if (!text) { setSendingCaption(false); return; }
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
    />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 p-4 md:p-8 overflow-hidden">
      <div className="h-full mx-auto max-w-5xl flex flex-col rounded-2xl shadow-2xl bg-white/80 backdrop-blur-md border border-slate-200">
        {toast && <div className="fixed top-4 right-4 z-50 rounded-xl bg-black/90 text-white px-4 py-2 text-base shadow-2xl font-semibold tracking-wide animate-fadein">{toast}</div>}

        <header className="flex items-center justify-between gap-4 mb-2 border-b border-slate-200 px-4 py-3 bg-white/70 rounded-t-2xl">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-800 drop-shadow-sm">Nois WebRTC</h1>
          <div className="flex gap-2 items-center">
            <button className={`px-4 py-2 rounded-lg font-semibold transition-all duration-150 border-2 ${tab==="call" ? "bg-blue-600 text-white border-blue-600 shadow-md" : "bg-white text-blue-700 border-blue-200 hover:bg-blue-50"}`} onClick={()=>setTab("call")}>通話</button>
            <button className={`px-4 py-2 rounded-lg font-semibold transition-all duration-150 border-2 ${tab==="settings" ? "bg-blue-600 text-white border-blue-600 shadow-md" : "bg-white text-blue-700 border-blue-200 hover:bg-blue-50"}`} onClick={()=>setTab("settings")}>設定</button>
            {onBack && (
              <button onClick={onBack} className="ml-4 px-4 py-2 rounded-lg font-semibold border-2 border-gray-400 bg-white text-gray-700 hover:bg-gray-100 transition-all">ホームへ戻る</button>
            )}
          </div>
        </header>
        {roleLabel && (
          <div className="mb-4 flex items-center gap-3 px-4">
            <span className="px-3 py-1 rounded-full text-white font-bold text-base" style={{background: roleColor||'#2563eb'}}>{roleLabel}</span>
            {roleDescription && <span className="text-gray-700 text-sm">{roleDescription}</span>}
          </div>
        )}

        {tab === "call" ? (
          !uiCallStarted ? (
            // --- 接続設定画面（通話前） ---
            <div className="flex-1 flex flex-col gap-3 overflow-hidden bg-gray-100 p-3">
              <div className="bg-white border border-gray-300 p-3 max-w-xl mx-auto">
                <h2 className="text-base font-semibold text-gray-800 mb-3 pb-2 border-b border-gray-300">接続設定</h2>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <button onClick={micEnabled?stopMic:startMic} className={"px-3 py-2 text-white text-sm font-medium border " + (micEnabled ? "bg-red-600 border-red-600" : "bg-blue-600 border-blue-600")}> 
                    {micEnabled ? "Stop Mic" : "Start Mic"}
                  </button>
                  <button onClick={toggleMute} disabled={!micEnabled} className={"px-3 py-2 text-white text-sm font-medium border " + (!micEnabled ? "bg-gray-400 border-gray-400 cursor-not-allowed" : (micMuted ? "bg-amber-600 border-amber-600" : "bg-amber-500 border-amber-500"))}>
                    {micMuted ? "Unmute" : "Mute"}
                  </button>
                  <button onClick={createNewConnection} className="px-3 py-2 text-white text-sm font-medium border bg-gray-600 border-gray-600">
                    新規接続
                  </button>
                  <div className="text-sm text-gray-600 bg-gray-50 px-2 py-1 border border-gray-300">
                    PC: {connState} / ICE: {iceState} / DC: {dcState}
                  </div>
                  {localStreamRef.current && (
                    <div className="text-sm text-blue-600 bg-blue-50 px-2 py-1 border border-blue-300">
                      🎤 ローカル音声: {localStreamRef.current.getAudioTracks().length}トラック
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <div>
                    <h3 className="font-medium text-gray-700 mb-2 text-sm">Local SDP（相手へ渡す）</h3>
                    <div className="relative">
                      <textarea ref={localSDPRef} className="w-full h-40 border border-gray-300 p-2 text-sm font-mono bg-gray-50" readOnly />
                      <button
                        onClick={async ()=>{ try{ await navigator.clipboard.writeText(localSDPRef.current?.value||""); setCopiedLocal(true); showToast("Local SDP copied"); setTimeout(()=>setCopiedLocal(false),1200);}catch{} }}
                        className={"absolute top-2 right-2 px-2 py-1 text-white text-sm border " + (copiedLocal ? "bg-green-600 border-green-600" : "bg-gray-600 border-gray-600")}
                      >{copiedLocal?"Copied!":"Copy"}</button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Caller は Offer、Answerer は Answer をここに出力します。</p>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-700 mb-2 text-sm">Remote SDP（相手から貼付け）</h3>
                    <textarea ref={remoteSDPRef} className="w-full h-40 border border-gray-300 p-2 text-sm font-mono bg-gray-50" placeholder="相手から受け取った JSON を貼り付け" />
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button onClick={createOffer} disabled={creatingOffer || role!=="caller"} className={"px-3 py-2 text-white text-sm font-medium border " + (role!=="caller" ? "bg-gray-400 border-gray-400 cursor-not-allowed" : (creatingOffer ? "bg-indigo-400 border-indigo-400 cursor-not-allowed" : "bg-indigo-600 border-indigo-600"))}>
                        {creatingOffer ? "Creating..." : "Create Offer（Caller）"}
                      </button>
                      <button onClick={acceptOfferAndCreateAnswer} disabled={answering || role!=="answerer"} className={"px-3 py-2 text-white text-sm font-medium border " + (role!=="answerer" ? "bg-gray-400 border-gray-400 cursor-not-allowed" : (answering ? "bg-indigo-400 border-indigo-400 cursor-not-allowed" : "bg-indigo-600 border-indigo-600"))}>
                        {answering ? "Answering..." : "Paste Offer → Create Answer（Answerer）"}
                      </button>
                      <button onClick={setRemoteDescriptionManual} disabled={settingRemote} className={"px-3 py-2 text-white text-sm font-medium border " + (settingRemote ? "bg-gray-400 border-gray-400 cursor-not-allowed" : "bg-gray-600 border-gray-600")}> 
                        {settingRemote ? "Setting..." : "Set Remote Description"}
                      </button>
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
                  </div>
                </div>
              </div>
            </div>
          ) : (
            // --- 通話画面（音声＋字幕） ---
            <div className="flex-1 flex flex-col lg:flex-row gap-3 overflow-hidden bg-gray-100 p-3">
              <div className="flex-1 flex flex-col space-y-3">
                <div className="bg-white border border-gray-300 p-3">
                  <h2 className="text-base font-semibold text-gray-800 mb-3 pb-2 border-b border-gray-300">音声</h2>
                  <audio ref={remoteAudioRef} autoPlay playsInline controls className="w-full" />
                  <p className="text-sm text-gray-600 mt-2">双方で「Start Mic」を押すとリアルタイム音声通話が始まります。</p>
                </div>
                <div className="bg-white border border-gray-300 p-3 flex-1 overflow-hidden">
                  <h2 className="text-base font-semibold text-gray-800 mb-3 pb-2 border-b border-gray-300">字幕（DataChannel）</h2>
                  <div className="flex items-center gap-2 flex-wrap mb-3">
                    <input className="flex-1 min-w-0 border border-gray-300 px-2 py-2 bg-white" value={sendText} onChange={(e)=>setSendText(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendCaption(); }}} placeholder="字幕として送りたいテキスト"/>
                    <button onClick={sendCaption} disabled={sendingCaption} className={"px-3 py-2 text-white text-sm font-medium border " + (sendingCaption ? "bg-gray-400 border-gray-400 cursor-not-allowed" : "bg-emerald-600 border-emerald-600")}> 
                      {sendingCaption? "Sending..." : (dcState==="open" ? "Send" : "Queue") }
                    </button>
                  </div>
                  <div className="h-64 overflow-auto border border-gray-300 p-3 bg-gray-50">
                    <ul className="space-y-1">{captions.map((c,i)=>(<li key={i} className={`text-sm text-gray-700 border-b border-gray-200 pb-1 ${c.startsWith("(you) ") ? "text-left" : "text-right"}`}>{c}</li>))}</ul>
                  </div>
                </div>
              </div>
            </div>
          )
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
                      <button onClick={()=>{ const sample = ttsLang==="ja"?"テスト。こんにちは。":"Test: Hello there."; speak(sample); }} className="px-3 py-2 bg-gray-600 text-white text-sm font-medium border border-gray-600">TTS Test</button>
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
