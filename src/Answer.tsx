import React from "react";
import App from "./App";

// App.tsxのロジックをAnswer用に使う。roleを"answerer"で固定
export default function Answer(props: any) {
  return (
    <App
      forcedRole="answerer"
      roleLabel="受信者用 (Answerer)"
      roleDescription="この画面は受信者（Callを受ける側）専用です。手順: 1. マイク開始→2. Offerを貼付け→3. Answer作成→4. 相手にSDPを送信。"
      roleColor="#059669"
      {...props}
    />
  );
}
