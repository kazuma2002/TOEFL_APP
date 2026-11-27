# TOEFL 5.5 Trainer

TOEFL iBT（2026年1月以降の新形式）で総合5.5以上を安定して取ることを目指す、スマホ向けのオフライン学習アプリ（PWA）。

## 使い方（Android）

1. Chromeで公開URLを開く。
2. メニュー（︙）→「ホーム画面に追加」（または「アプリをインストール」）を選ぶ。
3. 一度オンラインで開いた後は、通信なしでも起動できる。Stats → オフライン準備チェックで状態を確認できる。
4. リスニングとスピーキングの音声は端末の読み上げ機能を使う。オフラインで使うには、Androidの「設定 → システム → 言語 → テキスト読み上げ」で、Google音声サービスの英語の音声データをダウンロードしておく。

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` / `styles.css` / `app.js` | 画面と動作。ライブラリやビルド工程は使わない |
| `data/reading.json` ほか | 問題データ（すべてオリジナル）。reading / listening / writing / speaking に分割 |
| `data/vocab.json` | 単語帳（400語、10分野） |
| `data/tips.json` | タスク別ガイド・戦略ガイド・表現集・今日のTip |
| `sw.js` | Service Worker。全ファイルを事前キャッシュする |
| `manifest.webmanifest` / `icons/` | ホーム画面追加の設定とアイコン |

## 収録内容（v0.2）

- Reading：Complete the Words 10題 / Read in Daily Life 10題 / Read an Academic Passage 6題
- Listening：Choose a Response 20問（4セット）/ Conversation 8題 / Announcement 6題 / Academic Talk 6題
- Writing：Build a Sentence 40問（4セット・文法タグ付き）/ Write an Email 8題 / Academic Discussion 8題
- Speaking：Listen and Repeat 6セット（各7文）/ Take an Interview 6セット（各4問）
- 単語帳：400語（アカデミック共通150・分野別200・キャンパス生活50）。カード（英→日・日→英・音声→意味）、聞き流し、書き取り、一覧
- Tips：12タスクの解き方ガイド（練習中も「？」から表示）、戦略ガイド4本、言い換え表現60個、今日のTip

## 更新するとき

1. ファイルを変更したら、`sw.js` の `VERSION` と `app.js` の `APP_VERSION` を同じ値に上げる。
2. mainブランチにpushすると、GitHub Pagesに反映される。
3. アプリを開くと「新しいバージョンがある」と表示されるので、「更新する」を押す。

問題を追加するときは `data/content.json` の該当配列に、既存と同じ形式で項目を追加する。`id` は重複させない。

## 学習記録

記録はブラウザ内（IndexedDB）にだけ保存される。Stats → バックアップからJSONファイルに書き出し・復元できる。
