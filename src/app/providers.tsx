"use client";

import { Authenticator } from "@aws-amplify/ui-react";
import { PrivyProvider } from "@privy-io/react-auth";
import { Amplify } from "aws-amplify";
import type { ReactNode } from "react";
import outputs from "../../amplify_outputs.json";

Amplify.configure(outputs);

function hasAuthConfig() {
  const auth = (outputs as { auth?: unknown }).auth;
  return Boolean(auth);
}

export function Providers({ children }: { children: ReactNode }) {
  if (!hasAuthConfig()) {
    return (
      <main className="auth-missing">
        <section>
          <p className="eyebrow">Amplify Auth</p>
          <h1>Auth backend is not deployed yet</h1>
          <p>
            Cognito の設定がまだ amplify_outputs.json にありません。Amplify
            backend をデプロイすると、ログイン画面が有効になります。
          </p>
        </section>
      </main>
    );
  }

  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const content = privyAppId ? (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "light" },
      }}
    >
      {children}
    </PrivyProvider>
  ) : (
    children
  );

  return (
    <Authenticator variation="modal" hideSignUp={false}>
      {content}
    </Authenticator>
  );
}
