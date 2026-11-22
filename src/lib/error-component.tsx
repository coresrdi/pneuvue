import type { ErrorComponentProps } from "@tanstack/react-router";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "Impossible d'afficher cet écran.";
  return (
    <main className="min-h-dvh bg-bg px-4 py-8 text-fg">
      <h1 className="font-display text-2xl font-semibold">Une erreur est survenue</h1>
      <p className="mt-2 text-muted">{message}</p>
    </main>
  );
}
