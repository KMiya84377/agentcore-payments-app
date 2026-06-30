"use client";

import type { ReactNode } from "react";
import { AmplifyAuthProvider } from "./providers/AmplifyAuthProvider";
import { PrivyAppProvider } from "./providers/PrivyAppProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AmplifyAuthProvider>
      <PrivyAppProvider>{children}</PrivyAppProvider>
    </AmplifyAuthProvider>
  );
}
