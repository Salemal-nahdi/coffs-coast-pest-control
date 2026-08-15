import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasPasswordSet } from "@/lib/auth";
import LoginForm from "./LoginForm";

const SESSION_COOKIE = "portal_session";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const store = cookies();
  const session = store.get(SESSION_COOKIE)?.value === "authorized";

  // If the portal has a password and the user is already authorised,
  // send them straight to the dashboard.
  if (hasPasswordSet() && session) {
    redirect("/portal");
  }

  // No password configured -> treat as open access, go to dashboard.
  if (!hasPasswordSet()) {
    redirect("/portal");
  }

  return <LoginForm />;
}
