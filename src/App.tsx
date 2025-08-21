import React, { useEffect, useMemo, useRef, useState } from "react";
import { Lang, Translator, detect, translate } from "./translate";

type Role = "caller" | "answerer";
const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type Tab = "call" | "settings";

export default function App() {
  const [tab, setTab] = useState<Tab>("call");
  const [pc, setPc] = useState<RTCPeerConnection | null>(null);
  const [role, setRole] = useState<Role>("caller");
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
    };
    p.onconnectionstatechange = () => setConnState(p.connectionState);
    p.oniceconnectionstatechange = () => setIceState(p.iceConnectionState);
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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;
    for (const s of pc.getSenders()) if (s.track && s.track.kind === "audio") pc.removeTrack(s);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    setMicEnabled(true); setMicMuted(false);
  }
  function stopMic() {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    setMicEnabled(false); setMicMuted(false);
  }
  function toggleMute() {
    const s = localStreamRef.current;
    if (!s) return;
    const to = !micMuted;
    s.getAudioTracks().forEach(t => t.enabled = !to);
    setMicMuted(to);
  }

  // Manual signaling
  async function createOffer() {
    if (!pc) return;
    setCreatingOffer(true);
    try {
      const ch = pc.createDataChannel("captions");
      wireDataChannel(ch);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForICEGathering(pc);
      localSDPRef.current!.value = JSON.stringify(pc.localDescription);
      showToast("Offer created");
    } finally { setCreatingOffer(false); }
  }
  async function acceptOfferAndCreateAnswer() {
    if (!pc || !remoteSDPRef.current) return;
    setAnswering(true);
    try {
      const offer = JSON.parse(remoteSDPRef.current.value);
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForICEGathering(pc);
      localSDPRef.current!.value = JSON.stringify(pc.localDescription);
      showToast("Answer created");
    } finally { setAnswering(false); }
  }
  async function setRemoteDescriptionManual() {
    if (!pc || !remoteSDPRef.current) return;
    setSettingRemote(true);
    try {
      const remote = JSON.parse(remoteSDPRef.current.value);
      await pc.setRemoteDescription(remote);
      showToast("Remote description set");
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

  return (
    <div className="h-screen p-4 md:p-6 overflow-hidden">
      <div className="h-full mx-auto max-w-6xl flex flex-col">
        {toast && <div className="fixed top-4 right-4 z-50 rounded-lg bg-black/80 text-white px-3 py-2 text-sm shadow-lg">{toast}</div>}

        <header className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-xl md:text-2xl font-bold">Manual WebRTC Call</h1>
          <div className="flex gap-2">
            <button className={"tab " + (tab==="call"?"tab-active":"tab-inactive")} onClick={()=>setTab("call")}>通話</button>
            <button className={"tab " + (tab==="settings"?"tab-active":"tab-inactive")} onClick={()=>setTab("settings")}>設定</button>
          </div>
        </header>

        {tab === "call" ? (
          <div className="flex-1 flex flex-col lg:flex-row gap-3 overflow-hidden bg-gray-100 p-3">
            {/* 左側：接続設定 */}
            <div className="flex-shrink-0 lg:w-1/2 space-y-3">
              <div className="bg-white border border-gray-300 p-3">
                <h2 className="text-base font-semibold text-gray-800 mb-3 pb-2 border-b border-gray-300">接続設定</h2>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <button onClick={micEnabled?stopMic:startMic} className={"px-3 py-2 text-white text-sm font-medium border " + (micEnabled ? "bg-red-600 border-red-600" : "bg-blue-600 border-blue-600")}>
                    {micEnabled ? "Stop Mic" : "Start Mic"}
                  </button>
                  <button onClick={toggleMute} disabled={!micEnabled} className={"px-3 py-2 text-white text-sm font-medium border " + (!micEnabled ? "bg-gray-400 border-gray-400 cursor-not-allowed" : (micMuted ? "bg-amber-600 border-amber-600" : "bg-amber-500 border-amber-500"))}>
                    {micMuted ? "Unmute" : "Mute"}
                  </button>
                  <div className="text-sm text-gray-600 bg-gray-50 px-2 py-1 border border-gray-300">
                    PC: {connState} / ICE: {iceState} / DC: {dcState}
                  </div>
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

                      <div className="flex items-center gap-2 ml-auto">
                        <label className="text-sm font-medium text-gray-700">Role:</label>
                        <select className="border border-gray-300 px-2 py-1 text-sm bg-white" value={role} onChange={(e)=>setRole(e.target.value as Role)}>
                          <option value="caller">Caller</option>
                          <option value="answerer">Answerer</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 右側：音声と字幕 */}
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
