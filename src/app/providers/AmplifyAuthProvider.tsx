"use client";

import { Authenticator } from "@aws-amplify/ui-react";
import { Amplify } from "aws-amplify";
import type { ReactNode } from "react";
import outputs from "../../../amplify_outputs.json";

Amplify.configure(outputs);

export function AmplifyAuthProvider({ children }: { children: ReactNode }) {
  return (
    <Authenticator variation="modal" hideSignUp={false}>
      {children}
    </Authenticator>
  );
}
