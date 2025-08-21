
# Manual WebRTC Voice Call with Captions (Tabs Version)


## セットアップ

```bash
npm install
npm run dev

ブラウザで http://localhost:5173 を開きます。

⸻

## 使い方（手動シグナリング）

1. 2つのブラウザを用意
	•	タブを2つ開く、または別のPC/スマホで開く

2. Caller 側
	•	Role を Caller にする
	•	「Create Offer」を押す
	•	Local SDP が出力されるのでコピーして Answerer に渡す

3. Answerer 側
	•	Role を Answerer にする
	•	受け取った Offer JSON を Remote SDP に貼り付け
	•	「Paste Offer → Create Answer」を押す
	•	Local SDP が出力されるのでコピーして Caller に渡す

4. Caller 側（続き）
	•	受け取った Answer JSON を Remote SDP に貼り付け
	•	「Set Remote Description」を押す

5. 双方で接続完了
	•	ヘッダーのステータスが
PC: connected / ICE: connected / DC: open になれば接続成功

⸻

## 音声通話
	•	双方で 「Start Mic」 を押すとリアルタイム音声通話が開始
	•	「Mute」で自分のマイクを一時停止
	•	リモート音声 はページ内の <audio> プレイヤーで再生

⸻

## 字幕（DataChannel）
	•	入力欄にテキストを入れて Enter または Send ボタンで送信
	•	相手に字幕として表示される
	•	DC: open 前に送信した字幕は Queue 状態でキューされ、Open 後に自動送信される
	•	受信字幕は（設定次第で）自動的に TTS 読み上げ される

⸻

## 設定タブ

翻訳
	•	From: Auto / JA / EN
	•	To: Auto / JA / EN
	•	Translator: mini-dict（簡易辞書） / mock（タグ付け） / none（翻訳なし）

TTS（受信字幕の読み上げ）
	•	有効 / 無効チェック
	•	言語: Auto（自動判定）、JA、EN
	•	ブラウザが提供する音声一覧から Voice を選択
	•	TTS Test ボタンで確認可能

⸻

## 注意事項
	•	サーバ不要（STUNのみ使用）。NAT環境によっては接続できない場合あり → TURN サーバを iceServers に追加可能
	•	ブラウザ自動再生制限 により、最初は操作後でないと音声が鳴らないことがあります
	•	受信字幕の TTS はブラウザ依存（Chrome/Edge は日本語/英語対応、Safari は制限あり）

⸻

## プロジェクト構成

src/
 ├─ App.tsx         # UI本体（通話 / 設定タブ）
 ├─ translate.ts    # 簡易翻訳ロジック
 ├─ main.tsx        # エントリーポイント
 └─ index.css       # Tailwind スタイル