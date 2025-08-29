import React from "react";
import App from "./App";

// App.tsxのロジックをCaller用に使う。roleを"caller"で固定
export default function Caller(props: any) {
  return (
    <App
      forcedRole="caller"
      roleLabel="発信者用 (Caller)"
      roleDescription="この画面は発信者（Callを開始する側）専用です。手順: 1. マイク開始→2. Offer作成→3. 相手にSDPを送信→4. Answerを貼付け。"
      roleColor="#2563eb"
      {...props}
    />
  );
}
