# AWS WAF AIトラフィック収益化を使った販売サイト検証

## 目的

現在の決済エージェントを購入者として使い、自分たちで用意した有料コンテンツへ
AgentCore Payments経由でアクセスできることを検証する。

外部のx402マーチャントを探す代わりに、自分たちで小さな販売サイトを用意する。
販売サイトのHTTP 402応答、支払い検証、コンテンツ解放はAWS WAFの
AIトラフィック収益化機能に担当させる。

## 構成

```text
決済エージェント（購入者）
  |
  | GET /premium/report.html
  v
CloudFront
  |
  | AWS WAFが対象AIトラフィックへ402を返す
  | AgentCore Paymentsが支払い証明を生成する
  | 支払い証明付きリクエストをWAFが検証する
  v
S3（非公開のコンテンツオリジン）
```

販売サイトは次のリソースで構成する。

- AWS Blocksの`Hosting`
- Amazon CloudFront
- 非公開Amazon S3バケット
- Origin Access Control（OAC）
- CloudFrontに関連付けたAWS WAF Web ACL
- AWS WAF Bot Control
- AWS WAF AIトラフィック収益化ルール

AWS WAFの収益化アクションはCloudFrontに関連付けたWeb ACLでのみ利用できる。
S3へ直接アクセスさせる構成では利用しない。

## AWS Blocksを使う理由

AWS Blocksはアプリケーションコード、ローカル開発環境、AWSインフラストラクチャを
Blockとしてまとめるツールキットである。`Hosting`はCDKレイヤーで使用し、
フレームワークに合わせてCloudFrontとS3などを構成する。

今回の販売サイトは既存の決済エージェントとは別の役割を持つため、同じGitリポジトリ内に
独立した`merchant-site/`として配置する想定とする。

```text
Amplify Gen2 仕組み/
├── agent-runtime/     # 支払いを行うAgentCore Runtime
├── amplify/           # 決済エージェント側のインフラ
├── src/               # 決済エージェントのNext.js UI
├── merchant-site/     # AWS Blocksで作る販売サイト
└── docs/
```

AWS Blocksの通常のコマンドは次のとおり。

```bash
npm run dev
npm run deploy
npm run destroy
```

`npm run deploy`はホスティングを含む完全なCDKデプロイを行う。
`npm run sandbox`はバックエンドの高速な検証用であり、Hostingはデプロイしない。

## WAFの手動設定

AWS Blocksで販売サイトをデプロイした後、作成されたCloudFrontディストリビューションに
対してAWSマネジメントコンソールから設定する。

1. CloudFront用のAWS WAF Web ACL（保護パック）を作成する
2. AWS WAF Bot Controlを有効にする
3. 販売サイトのCloudFrontディストリビューションを関連付ける
4. `/premium/*`を収益化対象として指定する
5. 通貨モードを`TEST`にする
6. Base Sepoliaの受取先ウォレットを指定する
7. 1リクエスト当たりの少額価格をUSDCで設定する
8. 検証後に必要であれば通貨モードを`REAL`へ切り替える

Bot ControlによるAIエージェント分類が収益化ルールの前提になる。検証済み・未検証などの
分類ごとに、収益化、許可、ブロック、カウントなどの動作を設定できる。

## テスト時の注意

- 最初は必ず`TEST`モードを使用する
- 支払元と受取先には別のウォレットを使用する
- Base SepoliaのテストUSDCを使用する
- `/premium/*`以外の通常ページは無料で閲覧できるようにする
- 最初のコンテンツはHTMLまたはJSONの1ファイルで十分
- CloudWatchで402、支払い処理、再試行、200応答を確認する
- 本番化前に価格上限、PaymentSessionの予算、有効期限を小さく設定する
- 現在のPrivy Signerは`policyIds: []`で制限されていないため、本番ではPolicyを設定する

## 想定する検証シーケンス

1. AgentがCloudFront上の有料コンテンツへGETする
2. AWS WAFがx402形式の`402 Payment Required`を返す
3. AgentCore Payments Pluginが402を検出する
4. PaymentSessionの予算を確認する
5. PaymentInstrumentとPrivy Signerを使って支払い証明を生成する
6. Agentが支払い証明付きで同じURLを再実行する
7. AWS WAFが支払いを検証・決済する
8. CloudFrontがS3のコンテンツを返す
9. Agentが取得したコンテンツをユーザーへ提示する

## AWS MCP Server

AWSドキュメントを繰り返し調査する用途では、旧AWS Knowledge MCP Serverではなく、
後継のマネージドAWS MCP Serverを使用する。AWS公式は旧Knowledge/API MCP Serverから
AWS MCP Serverへの移行を推奨している。

Codexの設定例:

```toml
[mcp_servers.aws_mcp]
command = "uvx"
args = [
  "mcp-proxy-for-aws@latest",
  "https://aws-mcp.us-east-1.api.aws/mcp",
  "--metadata", "AWS_REGION=us-east-1"
]
startup_timeout_sec = 60
```

設定後はCodexを再起動する。AWS MCP ServerはAWSドキュメント検索に使用する。
Amazon Bedrock Knowledge Bases Retrieval MCP Serverは、自社Knowledge Base内の情報を
検索する別用途のMCP Serverである。

## Gitの現在地

このワークスペースはローカルGitリポジトリとして初期化済みである。

- リポジトリ: `/Users/k_miyazaki/Documents/Amplify Gen2 仕組み`
- 現在のブランチ: `main`
- Gitリモート: 未設定
- 実装ファイルの多く: 未コミット

販売サイト実装前または実装後の区切りで、秘密情報が除外されていることを確認してから
初回コミットとGitHubリモート設定を行う。

## 参考資料

- [AWS WAFにAIトラフィック収益化機能が追加](https://aws.amazon.com/jp/blogs/news/aws-waf-adds-ai-traffic-monetization-capability-to-help-content-owners-charge-ai-bots-for-content-access/)
- [What is AWS Blocks?](https://docs.aws.amazon.com/blocks/latest/devguide/what-is-blocks.html)
- [AWS Blocks Hosting](https://docs.aws.amazon.com/blocks/latest/devguide/bb-hosting.html)
- [Deploy your AWS Blocks application](https://docs.aws.amazon.com/blocks/latest/devguide/deploy-to-aws.html)
- [AWS MCP Serverのセットアップ](https://docs.aws.amazon.com/aws-mcp/latest/userguide/getting-started-aws-mcp-server.html)
- [AgentCore Paymentsの仕組み](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-how-it-works.html)
