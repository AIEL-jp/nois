import React from "react";

const icons = {
  user: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 8-4 8-4s8 0 8 4"/></svg>,
  friends: <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><path d="M7 10v4M17 10v4M2 21c0-2.5 3.5-4 5-4s5 1.5 5 4"/><path d="M12 21c0-2.5 3.5-4 5-4s5 1.5 5 4"/></svg>,
  call: <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 16.92V21a2 2 0 0 1-2.18 2A19.72 19.72 0 0 1 3 5.18 2 2 0 0 1 5 3h4.09a2 2 0 0 1 2 1.72c.13 1.13.37 2.23.72 3.28a2 2 0 0 1-.45 2.11l-1.27 1.27a16 16 0 0 0 6.29 6.29l1.27-1.27a2 2 0 0 1 2.11-.45c1.05.35 2.15.59 3.28.72A2 2 0 0 1 22 16.92z"/></svg>,
  reception: <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 21v-2a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  home: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 12l9-9 9 9"/><path d="M9 21V9h6v12"/></svg>,
  clock: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
  mouth: <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 15c4 4 12 4 16 0"/></svg>,
  bell: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  settings: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
};

export default function Home({ onCall, onReception, onFriendList }: { onCall: () => void, onReception?: () => void, onFriendList: () => void }) {
  return (
    <div className="min-h-screen flex flex-col bg-white home-font relative">
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
      <header className="flex items-center justify-between px-4 pt-4 pb-2 mb-6 border-b border-slate-200 overflow-visible relative z-10">
            <div className="text-3xl font-extrabold pr-1 bg-gradient-to-r from-sky-400 to-slate-500 bg-clip-text text-transparent drop-shadow-sm select-none" style={{letterSpacing:'-1px'}}>Nois</div>
        <div className="text-slate-500">{icons.user}</div>
      </header>

      {/* メイン */}
      <main className="flex-1 flex flex-col items-center px-2 pb-24 pt-2 relative z-10">
        <div className="w-9/12 h-48 bg-black rounded-xl mb-4 flex items-center justify-center">
          <span className="text-white text-xl font-medium">Tutorial Movie</span>
        </div>
        <div className="w-full flex flex-col gap-4 items-center">
          <button onClick={onFriendList} className="w-full max-w-xs flex flex-row items-center justify-center border-2 border-slate-300 rounded-xl py-3 bg-white shadow-md active:scale-95 transition-all gap-2">
            <img src="/friend-icon.png" alt="friend" className="w-7 h-7 object-contain" />
            <span className="text-2xl font-extrabold bg-gradient-to-r from-sky-400 to-slate-500 bg-clip-text text-transparent tracking-tight">Friend List</span>
          </button>
          <div className="w-full max-w-xs grid grid-cols-2 gap-4">
            <button onClick={onCall} className="flex flex-row items-center justify-center border-2 border-slate-300 rounded-xl py-3 bg-white shadow-md active:scale-95 transition-all gap-2">
              <img src="/call-icon.png" alt="call" className="w-7 h-7 object-contain" />
              <span className="text-xl font-extrabold bg-gradient-to-r from-slate-600 to-slate-400 bg-clip-text text-transparent">Call</span>
            </button>
            <button onClick={onReception} className="flex flex-row items-center justify-center border-2 border-slate-300 rounded-xl py-3 bg-white shadow-md active:scale-95 transition-all gap-2">
              <img src="/reception-icon.png" alt="reception" className="w-10 h-10 object-contain" />
              <span className="text-xl font-extrabold bg-gradient-to-r from-slate-600 to-slate-400 bg-clip-text text-transparent">reception</span>
            </button>
          </div>
        </div>
      </main>

      {/* ナビゲーションバー */}
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
