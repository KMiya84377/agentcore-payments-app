# defineHosting のコードベース読み解き

このメモは、現在インストールされている `@aws-amplify/hosting` のコードを前提に、
`defineHosting` が何を受け取り、どう動くかを整理したものです。

対象ファイル:

```text
node_modules/@aws-amplify/hosting/src/types.ts
node_modules/@aws-amplify/hosting/src/factory.ts
node_modules/@aws-amplify/hosting/README.md
amplify/hosting.ts
```

GitHub 上の該当コード:

- [`@aws-amplify/hosting` の repository](https://github.com/aws-amplify/amplify-backend): `node_modules/@aws-amplify/hosting/package.json` の `repository.url`
- [`packages/hosting/src/types.ts`](https://github.com/aws-amplify/amplify-backend/blob/5e276ddc2c2e57408b2aaca5a3e381d0db4c33dd/packages/hosting/src/types.ts): `HostingProps` / `HostingResources` の型定義
- [`packages/hosting/src/factory.ts`](https://github.com/aws-amplify/amplify-backend/blob/5e276ddc2c2e57408b2aaca5a3e381d0db4c33dd/packages/hosting/src/factory.ts): `defineHosting` の本体。`amplify/hosting.ts` に分離する理由もここのコメントに書かれている
- [`packages/hosting/README.md`](https://github.com/aws-amplify/amplify-backend/blob/5e276ddc2c2e57408b2aaca5a3e381d0db4c33dd/packages/hosting/README.md): `defineHosting` と sandbox / deploy の扱い

手元に入っている `@aws-amplify/hosting` は `0.0.0-iac-hosting-20260601123712` です。
npm registry の `gitHead` は `5e276ddc2c2e57408b2aaca5a3e381d0db4c33dd` なので、
上記リンクは `main` branch ではなく、この commit に固定しています。

## 1. 現在のプロジェクトでの定義

現在の `amplify/hosting.ts` は次の設定です。

```ts
import { defineHosting } from "@aws-amplify/hosting";

defineHosting({
  framework: "nextjs",
  buildCommand: "npm run build",
  storage: {
    retainOnDelete: true,
  },
});
```

意味は次です。

| 設定 | 意味 |
| --- | --- |
| `framework: "nextjs"` | Next.js 用 adapter を使う |
| `buildCommand: "npm run build"` | deploy 前に Next.js build を実行する |
| `storage.retainOnDelete: true` | Hosting 用 S3 bucket を stack 削除時に保持する |

## 2. defineHosting で指定できる主なパラメータ

`@aws-amplify/hosting/src/types.ts` の `HostingProps` では、主に次を指定できます。

```ts
defineHosting({
  buildCommand,
  framework,
  buildOutputDir,
  customAdapter,
  domain,
  waf,
  compute,
  cdn,
  storage,
  logging,
});
```

| パラメータ | 用途 |
| --- | --- |
| `framework` | `nextjs`, `nitro`, `nuxt`, `astro`, `spa`, `static` など。未指定なら package.json から自動判定 |
| `buildCommand` | Hosting deploy 前に実行する build コマンド |
| `buildOutputDir` | SPA/static 用の出力ディレクトリ。Next.js では基本使わない |
| `customAdapter` | 標準対応外 framework 用の adapter |
| `domain` | カスタムドメイン設定。`domainName`, `hostedZone`, 任意で `certificate` |
| `waf` | WAF 有効化、rate limit 設定 |
| `compute` | SSR Lambda の memory, timeout, concurrency, logRetention |
| `cdn` | CloudFront price class, CSP, geo restriction |
| `storage` | S3 hosting bucket の暗号化、削除時保持、artifact retention |
| `logging` | CloudFront access log の有効化と保持日数 |

## 3. compute の指定

SSR framework、今回でいう Next.js では Lambda compute が使われます。
`compute` では次を指定できます。

```ts
compute: {
  memorySize: 1024,
  timeout: Duration.seconds(30),
  reservedConcurrency: 10,
  provisionedConcurrency: 1,
  logRetention: RetentionDays.TWO_WEEKS,
}
```

| 設定 | 意味 |
| --- | --- |
| `memorySize` | SSR Lambda のメモリサイズ。デフォルトは 1024 MB |
| `timeout` | SSR Lambda の timeout。デフォルトは 30 秒 |
| `reservedConcurrency` | 予約済み同時実行数 |
| `provisionedConcurrency` | cold start 対策用の provisioned concurrency |
| `logRetention` | CloudWatch Logs の保持期間 |

## 4. cdn の指定

CloudFront に関する設定です。

```ts
cdn: {
  priceClass: PriceClass.PRICE_CLASS_100,
  contentSecurityPolicy: "...",
  geoRestriction: {
    type: "whitelist",
    countries: ["JP", "US"],
  },
}
```

| 設定 | 意味 |
| --- | --- |
| `priceClass` | CloudFront の price class |
| `contentSecurityPolicy` | CSP header |
| `geoRestriction` | 国単位のアクセス制限 |

## 5. storage の指定

Hosting asset を置く S3 bucket の設定です。

```ts
storage: {
  encryption: "S3_MANAGED",
  retainOnDelete: true,
  buildRetentionDays: 365,
}
```

| 設定 | 意味 |
| --- | --- |
| `encryption` | `S3_MANAGED` または `KMS` |
| `encryptionKey` | `KMS` を使う場合の KMS key |
| `retainOnDelete` | stack 削除時に bucket を残すか |
| `buildRetentionDays` | build artifact の保持日数 |

このプロジェクトでは `retainOnDelete: true` を設定しています。
CloudFormation stack 削除時に hosting bucket と asset を消さないためです。

## 6. domain の指定

カスタムドメインを使う場合の設定です。

```ts
domain: {
  domainName: "app.example.com",
  hostedZone: "example.com",
}
```

任意で ACM certificate を指定できます。
CloudFront 用の certificate は us-east-1 である必要があります。

## 7. defineHosting の内部処理

`@aws-amplify/hosting/src/factory.ts` では、おおむね次の流れで動きます。

```text
defineHosting(props)
  -> pipeline scope があれば pipeline stage 配下に HostingStack を作る
  -> 通常 deploy なら独立した CDK App / root stack を作る
  -> framework を自動判定、または props.framework を使う
  -> buildCommand があれば実行する
  -> framework adapter を選ぶ
  -> adapter が DeployManifest を作る
  -> AmplifyHostingConstruct に manifest と props を渡す
  -> S3 / CloudFront / Lambda などを作る
```

重要なのは、`defineHosting` は `amplify/backend.ts` ではなく
`amplify/hosting.ts` に置く前提で作られている点です。

コードコメントにも、Hosting は backend とは独立した CloudFormation stack として
デプロイされるため、`amplify/backend.ts` に入れないように書かれています。

## 8. sandbox との関係

`@aws-amplify/hosting` の README には、`defineHosting` は `ampx sandbox` では
サポートされず、Hosting resources は sandbox では skip されると説明されています。

つまり、sandbox は主に backend の開発用です。
Hosting まで含めて確認したい場合は、`ampx deploy` 系を使います。

## 9. AGENTCORE_RUNTIME_ARN の自動注入について

今回の構成では、Next.js API が `AGENTCORE_RUNTIME_ARN` を環境変数から読みます。

```ts
const agentRuntimeArn = process.env.AGENTCORE_RUNTIME_ARN;
```

一方で、AgentCore Runtime ARN は `amplify/agent-core-stack.ts` の backend 側で
作られます。

```ts
new cdk.CfnOutput(this, "AgentRuntimeArn", {
  value: this.runtime.agentRuntimeArn,
});
```

理想は、この output を Hosting 側の Next.js API 環境変数へ自動注入することです。
ただし、現在の `backend.ts` と `hosting.ts` は別 entrypoint で、Hosting は独立 stack として
動くため、今の構成のままでは `runtime.agentRuntimeArn` を `defineHosting` 側から
直接参照できません。

そのため、現時点では次の運用にしています。

```text
1. backend deploy
2. AgentRuntimeArn output を確認
3. .env.local または Amplify Hosting 環境変数に AGENTCORE_RUNTIME_ARN として設定
4. frontend deploy
```

自動化するなら、deploy 後スクリプトで CloudFormation output を読み取り、
`.env.local` や Amplify Hosting の環境変数へ反映する方式が現実的です。

## 10. 今回のプロジェクトでの結論

現時点では、`defineHosting` は次の用途に絞っています。

```ts
defineHosting({
  framework: "nextjs",
  buildCommand: "npm run build",
  storage: {
    retainOnDelete: true,
  },
});
```

`AGENTCORE_RUNTIME_ARN` は手動設定のままにします。
Payments 関連の `PAYMENTS_REGION`、`PAYMENT_MANAGER_ARN`、`PAYMENT_CONNECTOR_ID` は
Hosting ではなく、backend deploy / sandbox 実行時に shell から渡します。
