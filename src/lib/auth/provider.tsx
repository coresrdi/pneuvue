import type { ReactNode } from "react";

/**
 * Remplace le AuthProvider du prévisualiseur d'origine (module absent du dépôt).
 * PneuVue n'a pas de compte ni de serveur : tout est local (Zustand + localStorage).
 * Ce composant est un simple passe-plat, pour que la version web et l'app Android
 * fonctionnent hors ligne, sans backend (Supabase, Lovable, etc.).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  return children;
}
