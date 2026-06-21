# AG-UI Strands と AgentCore Payments Plugin の hook 調査メモ

## 背景

AgentCore Payments Plugin を使って、Strands Agent から x402 対応の有料 API を呼び出す検証をしている。

現状では、エージェントは `http_request` ツールで有料 API を呼び出せている。しかし、API から `402 Payment Required` が返ったあと、支払いヘッダーを生成して再リクエストする処理が動いていないように見える。

## 現象

確認できている挙動は以下。

- Agent は `http_request` ツールを実行できる
- Next.js の有料 API は `402 Payment Required` を返す
- Next.js 側ログでは、支払い証明ヘッダーが付いていない
  - `X-PAYMENT`
  - `PAYMENT-SIGNATURE`
- AgentCore 側ログに、Payments Plugin の `after_tool_call` が動いた形跡がない
  - `AfterToolCallEvent: tool=http_request`
  - `Detected 402 Payment Required`
  - `Generated payment header`
  - `Added payment header`

つまり、ツール実行までは進んでいるが、ツール実行後の支払い処理に入っていない。

## hook とは

ここでいう `hook` は Python 標準機能ではなく、Strands Agents 側の拡張機能。

Agent の実行ライフサイクル上の特定タイミングに、追加処理を差し込むための仕組み。

今回重要なのは、AgentCore Payments Plugin の `after_tool_call`。

これは「ツール実行が終わった直後」に呼ばれる想定の hook で、Payments Plugin はここで `402 Payment Required` を検知する。

想定される流れは以下。

1. Agent が `http_request` ツールで有料 API を呼ぶ
2. API が `402 Payment Required` を返す
3. `after_tool_call` hook がツール結果を見る
4. Payments Plugin が 402 を検知する
5. Payment Manager から支払いヘッダーを生成する
6. `X-PAYMENT` または `PAYMENT-SIGNATURE` を付ける
7. `http_request` を再実行する
8. API が支払い済みとして `200` を返す

## plugin と hook の関係

`plugin` と `hook` は同じものではない。

Strands Agents の `Plugin` は、`@hook` が付いたメソッドと `@tool` が付いたメソッドを自動検出して、それぞれ `plugin.hooks` と `plugin.tools` に保持する。

ローカルにインストールされている Strands Agents SDK の `strands/plugins/plugin.py` では、`Plugin.__init__()` が以下を行っている。

```python
self._hooks: list[HookCallback] = discover_hooks(self, self.name)
self._tools: list[DecoratedFunctionTool] = discover_tools(self, self.name)
```

同じクラスには、以下の property がある。

```python
@property
def hooks(self) -> list[HookCallback]:
    return self._hooks

@property
def tools(self) -> list[DecoratedFunctionTool]:
    return self._tools
```

また、`strands/plugins/registry.py` の `_PluginRegistry.add_and_init()` は、plugin を Agent に追加するときに以下を行う。

```python
call_init_method(plugin.init_agent, self._agent)
self._register_hooks(plugin)
self._register_tools(plugin)
```

つまり、`Agent(..., plugins=[payments_plugin])` を使うと、Strands Agents SDK 側では plugin の hook と tool が両方登録される。

ただし、AG-UI wrapper が template Agent からコピーしているのは tool registry であり、hook registry ではない。

## AgentCorePaymentsPlugin の事実確認

`AgentCorePaymentsPlugin` は `strands.plugins.Plugin` を継承している。

```python
class AgentCorePaymentsPlugin(Plugin):
```

ローカル環境で `AgentCorePaymentsPlugin` の実体を確認すると、以下だった。

```text
has register_hooks False
is HookProvider False
callable False
hooks count 2
tools count 5
```

この確認結果から分かることは以下。

- `payments_plugin` 本体は `HookProvider` ではない
- `payments_plugin` 本体は callable でもない
- そのため `Agent(hooks=[payments_plugin])` のように plugin 本体を `hooks` に渡すのは適切ではない
- 一方で `payments_plugin.hooks` から hook callback のリストは取り出せる

Strands Agents SDK の `Agent.__init__()` では、`hooks` 引数は以下のように処理されている。

```python
if hooks:
    for hook in hooks:
        if isinstance(hook, HookProvider):
            self.hooks.add_hook(hook)
        elif callable(hook):
            self.hooks.add_callback(None, hook)
        else:
            raise ValueError(...)
```

したがって、今回 AG-UI wrapper に渡すべきなのは `payments_plugin` 本体ではなく、`payments_plugin.hooks` から取り出した callable hook callback のリスト。

## コード上の原因候補

現状の `agent-runtime/app.py` では、Payments Plugin を Strands Agent に渡している。

```python
strands_agent = Agent(
    model=model,
    system_prompt=load_system_prompt(),
    tools=[
        list_payment_instruments,
        get_payment_instrument,
        create_payment_instrument,
        create_payment_session,
        get_payment_instrument_balance,
    ],
    plugins=[payments_plugin] if payments_plugin else [],
)

return StrandsAgent(
    agent=strands_agent,
    name="strands_agent",
    description="Strands AgentCore runtime that streams native AG-UI events.",
)
```

この `plugins=[payments_plugin]` により、Payments Plugin の `http_request` ツールは Strands Agent の tool registry に登録される。

一方、AG-UI の `StrandsAgent` wrapper は、渡された template Agent をそのまま実行するのではなく、スレッドごとに新しい `StrandsAgentCore` を作る。

AG-UI 側の実装では、template Agent から以下を取り出している。

```python
self._model = agent.model
self._system_prompt = agent.system_prompt
self._tools = list(agent.tool_registry.registry.values())
self._agent_kwargs = _extract_agent_kwargs(agent)
self._hooks = list(hooks) if hooks else []
```

つまり、ツールは template Agent からコピーされる。

しかし、`hooks` は template Agent から自動ではコピーされない。AG-UI wrapper の `hooks` 引数に渡されたものだけが `self._hooks` に入る。

さらに、AG-UI 側の `_AGUI_EXPLICIT_PARAMS` では `hooks` が明示的に除外されている。

```python
_AGUI_EXPLICIT_PARAMS = {
    "self",
    "model",
    "system_prompt",
    "tools",
    "messages",
    "hooks",
    "session_manager",
}
```

実行時にスレッドごとの Agent を作る箇所では、`self._hooks` がある場合だけ `hooks` が渡される。

```python
core_kwargs = dict(self._agent_kwargs)

if self._hooks:
    core_kwargs["hooks"] = list(self._hooks)

self._agents_by_thread[thread_id] = StrandsAgentCore(
    model=self._model,
    system_prompt=self._system_prompt,
    tools=self._tools,
    session_manager=session_manager,
    **core_kwargs,
)
```

したがって、現在のコードでは以下の状態になっている可能性が高い。

- `http_request` ツールは AG-UI 経由の実行 Agent に渡っている
- Payments Plugin の `after_tool_call` hook は実行 Agent に渡っていない

## 対策案

AG-UI wrapper に対して、Payments Plugin から取り出した hook callback を明示的に渡す。

修正イメージは以下。

```python
payments_plugin = create_payments_plugin(user)
plugins = [payments_plugin] if payments_plugin else []
hooks = list(payments_plugin.hooks) if payments_plugin else []

strands_agent = Agent(
    model=model,
    system_prompt=load_system_prompt(),
    tools=[
        list_payment_instruments,
        get_payment_instrument,
        create_payment_instrument,
        create_payment_session,
        get_payment_instrument_balance,
    ],
    plugins=plugins,
)

return StrandsAgent(
    agent=strands_agent,
    name="strands_agent",
    description="Strands AgentCore runtime that streams native AG-UI events.",
    hooks=hooks,
)
```

この場合の役割は以下。

- `plugins=plugins`
  - Payments Plugin のツールを template Agent に登録する
  - `http_request` などが tool registry に入る
- `hooks=hooks`
  - AG-UI wrapper が作る実行用 Agent に Payments Plugin 由来の hook callback を渡す
  - `after_tool_call` が発火するようにする

## 検証観点

修正後は、AgentCore 側ログで以下を確認する。

```text
AfterToolCallEvent: tool=http_request
Detected 402 Payment Required response from tool: http_request
Generated payment header
Added payment header
```

Next.js 側ログでは以下を確認する。

```text
[paid-weather] request received hasXPaymentHeader: true
```

または、x402 のバージョンによっては以下。

```text
[paid-weather] request received hasPaymentHeader: true
```

最終的に paid API の handler まで到達すれば、以下が出る。

```text
[paid-weather] settled handler reached
```

## 2026-06-20 の検証結果

`agent-runtime/app.py` を `hooks=list(payments_plugin.hooks)` に修正し、backend を再デプロイした。

AgentCore 側ログで以下を確認した。

```text
create_agent: payments_plugin_present=True payment_hooks_count=2 paid_weather_api_present=True
BeforeToolCallEvent: tool=http_request
AfterToolCallEvent: tool=http_request
Detected 402 Payment Required response from tool: http_request
Payment retry attempt 1/3
Generating payment header
```

これにより、AG-UI 経由の実行 Agent に Payments Plugin の hook callback が渡り、`after_tool_call` が発火していることを確認した。

その後、`ProcessPayment` 内で以下の AccessDenied が発生した。

```text
Failed to obtain resource payment token.
```

CloudTrail の `GetResourcePaymentToken` イベントを確認したところ、実際の拒否理由は `secretsmanager:GetSecretValue` の対象不足だった。

```text
Access denied when retrieving secret
.../stripeprivy/payment-auth-s6bzc-a05764e7/authprivkey-...
```

このため、`amplify/agent-core-stack.ts` の Payments service role policy に、既存の `appsecret-*` に加えて `authprivkey-*` secret への `secretsmanager:GetSecretValue` を追加した。

再デプロイ後、IAM policy には以下が反映された。

```text
.../stripeprivy/payment-auth-s6bzc-*/appsecret-*
.../stripeprivy/payment-auth-s6bzc-*/authprivkey-*
```

再テストでは、secret 取得の AccessDenied は解消した。その次の失敗は以下。

```text
Privy credentials are invalid. Please verify the credential configuration.
```

この時点で、AG-UI hook 問題と IAM secret resource 不足は解消済み。残課題は AgentCore Payments の Payment Connector / Privy credential configuration 側の認証情報確認。

## 注意点

この修正は AG-UI や AgentCore SDK のライブラリコードを直接変更しない。

アプリ側の `agent-runtime/app.py` で、AG-UI wrapper に `hooks=list(payments_plugin.hooks)` を渡す回避策。

根本的には、AG-UI Strands integration 側の README だけではこの挙動が分かりにくい。必要であれば upstream issue として、以下を報告する余地がある。

- template Agent の `plugins` 由来の hook が AG-UI 実行 Agent に自動継承されない
- その一方で tool registry はコピーされるため、ツールだけ動いて hook が動かない状態になり得る
- Payments Plugin のように tool と hook の組み合わせで成立する plugin では、問題が見えにくい
