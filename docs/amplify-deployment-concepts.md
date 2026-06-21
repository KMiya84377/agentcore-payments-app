# Amplify デプロイの考え方

このドキュメントでは、このプロジェクトで使う Amplify のデプロイコマンドの違いを整理します。

## プロジェクトルート

Amplify のコマンドはリポジトリルートで実行します。

```bash
cd "/Users/k_miyazaki/Documents/Amplify Gen2 仕組み"
```

リポジトリルートとは、以下が置かれているディレクトリです。

```text
package.json
amplify/
src/
agent-runtime/
cdk.json
```

## sandbox と deploy の違い

`ampx sandbox` はローカル開発用です。

```bash
npx ampx sandbox --identifier dev
```

開発用の backend resources を AWS に作成します。このプロジェクトでは、主に Auth と
AgentCore stack が対象です。

一方で、`sandbox` は `defineHosting` による Hosting や、`definePipeline` による
CI/CD pipeline は作成しません。

`ampx deploy` は、明示的なデプロイ用です。

```bash
npx ampx deploy --identifier dev
```

今回利用している preview 機能では、flag によってデプロイ対象を分けられます。

```text
ampx deploy --backend
  backend だけをデプロイします。Auth と AgentCore が対象です。

ampx deploy --frontend
  hosting だけをデプロイします。amplify/hosting.ts で定義した Next.js アプリが対象です。

ampx deploy --pipeline
  pipeline だけをデプロイします。CodePipeline、CodeBuild、CodeConnections、
  IAM role、artifact bucket などが対象です。

ampx deploy
  backend と hosting をまとめてデプロイします。
```

## Issue #3211 で追加されたもの

Issue #3211 は、Amplify Gen 2 に self-managed hosting と CI/CD を追加する RFC です。

主な追加は以下です。

```text
defineHosting()
  frontend hosting infrastructure をコードで定義します。

definePipeline()
  CI/CD pipeline infrastructure をコードで定義します。

ampx deploy --frontend
  hosting stack だけをデプロイします。

ampx deploy --pipeline
  pipeline stack だけをデプロイします。

ampx deploy --backend
  新しい deploy model の中で、backend stack だけをデプロイします。
```

従来の一般的な CI/CD は、Amplify Console や `ampx pipeline-deploy` を使う形でした。

今回の新しい model では、hosting と pipeline も TypeScript の IaC として管理できます。

```text
amplify/hosting.ts
amplify/pipeline.ts
```

## defineHosting

`amplify/hosting.ts` は、Next.js hosting infrastructure を定義します。

このプロジェクトでは、Amplify Console の標準 Git-connected hosting ではなく、
IaC として定義された hosting stack を使います。

デプロイは以下です。

```bash
npm run amplify:deploy:frontend
```

## definePipeline

`amplify/pipeline.ts` は CI/CD pipeline を定義します。

pipeline のデプロイは、アプリ本体を直接デプロイするのではなく、CI/CD pipeline そのものを
AWS に作成します。

その後は、設定した GitHub branch への push を CodePipeline が検知し、CodeBuild が
リポジトリルートで build / synth / deploy を実行します。

```bash
GITHUB_REPOSITORY_NAME=owner/repo \
CODECONNECTIONS_CONNECTION_ARN=arn:aws:codeconnections:us-east-1:123456789012:connection/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
npm run amplify:deploy:pipeline
```

この pipeline は root dependencies をインストールし、`agent-runtime/` をチェックし、
CDK synthesis を実行します。

`cdk.json` は CDK の entry point として `amplify/pipeline.ts` を指しています。
