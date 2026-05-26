import { z } from "zod";

import type { TaxType } from "../catalogue/types.js";

export const SessionFileSchema = z
  .object({
    session_id: z.string().min(1),
    created_at: z.string(),
    updated_at: z.string(),
    tax_type: z.enum(["kst", "gewst", "ust"]),
    year: z.string().regex(/^\d{4}$/),
    data_commit: z.string(),
    user_profile: z.object({
      required: z.record(z.unknown()),
      notes: z.record(z.string()),
    }),
    selected_forms: z.array(z.string()),
    /** Values keyed by `${form_slug}:${line_number}`. */
    filled_values: z.record(z.unknown()),
  })
  .strict();
export type SessionFile = z.infer<typeof SessionFileSchema>;

export function sessionStorageKey(taxType: TaxType, year: string, sessionId: string): string {
  return `${taxType}-${year}-${sessionId}`;
}
