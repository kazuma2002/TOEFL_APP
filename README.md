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
| `data/content.json` | 問題データ（すべてオリジナル問題） |
| `sw.js` | Service Worker。全ファイルを事前キャッシュする |
| `manifest.webmanifest` / `icons/` | ホーム画面追加の設定とアイコン |

## 収録タスク（最小版）

- Reading：Complete the Words 3題 / Read in Daily Life 3題 / Read an Academic Passage 2題
- Listening：Listen and Choose a Response 5問 / Conversation 2題 / Announcement 2題 / Academic Talk 2題
- Writing：Build a Sentence 10問 / Write an Email 2題 / Write for an Academic Discussion 2題
- Speaking：Listen and Repeat 2セット（各7文）/ Take an Interview 2セット（各4問）
- 語彙：アカデミック語彙50語（間隔反復）、C1向け言い換え表現集

## 更新するとき

1. ファイルを変更したら、`sw.js` の `VERSION` と `app.js` の `APP_VERSION` を同じ値に上げる。
2. mainブランチにpushすると、GitHub Pagesに反映される。
3. アプリを開くと「新しいバージョンがある」と表示されるので、「更新する」を押す。

問題を追加するときは `data/content.json` の該当配列に、既存と同じ形式で項目を追加する。`id` は重複させない。

## 学習記録

記録はブラウザ内（IndexedDB）にだけ保存される。Stats → バックアップからJSONファイルに書き出し・復元できる。
