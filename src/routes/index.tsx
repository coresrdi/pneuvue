import { createFileRoute } from "@tanstack/react-router";
import { PneuApp } from "@/components/tpms/pneu-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <PneuApp />;
}
