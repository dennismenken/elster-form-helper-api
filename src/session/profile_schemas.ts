import { z } from "zod";

import type { TaxType } from "../catalogue/types.js";

/**
 * Per-tax-type required profile schemas. The MCP server owns these (per
 * AGENTS.md §11) so profile semantics can evolve independently from the
 * upstream data repo.
 *
 * Two things travel together for every field:
 *   - a Zod validator for runtime checking (`schema`)
 *   - human-facing metadata in German (`question_de`, `impact_de`) used by
 *     `session_get_open_questions` to ask the LLM's user the right thing in
 *     their language.
 */

export interface ProfileFieldMeta {
  question_de: string;
  impact_de: string;
}

export const KstProfileSchema = z.object({
  legal_form: z
    .enum(["GmbH", "UG", "AG", "SE", "KGaA", "eG", "e.V.", "Stiftung", "BgA", "other"])
    .nullable(),
  business_type: z.enum(["commercial", "non_profit", "association", "public_entity"]).nullable(),
  fiscal_year_end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date YYYY-MM-DD")
    .nullable(),
  has_foreign_operations: z.boolean().nullable(),
  has_economic_business_activity: z.boolean().nullable(),
  is_organschaft_subsidiary: z.boolean().nullable(),
  is_organschaft_parent: z.boolean().nullable(),
  has_loss_carryforward: z.boolean().nullable(),
});
export type KstProfile = z.infer<typeof KstProfileSchema>;

export const KstProfileMeta: Record<keyof KstProfile, ProfileFieldMeta> = {
  legal_form: {
    question_de:
      "Welche Rechtsform hat die Körperschaft? (z.B. GmbH, UG, AG, Genossenschaft, Verein)",
    impact_de:
      "Bestimmt, welche Sondertatbestände zu prüfen sind und welche Anlagen relevant sein können.",
  },
  business_type: {
    question_de:
      "Was ist die wirtschaftliche Tätigkeitsart der Körperschaft (commercial, non_profit, association, public_entity)?",
    impact_de:
      "Steuert die Auswahl gemeinnütziger/öffentlich-rechtlicher Anlagen (z.B. Anlage Gem, Anlage ÖHK).",
  },
  fiscal_year_end: {
    question_de: "Wann endet das Wirtschaftsjahr (Format JJJJ-MM-TT)?",
    impact_de:
      "Notwendig für Abgabefristen und für die Auswahl bestimmter Anlagen-Varianten (z.B. Zinsschranke nach 14.12.2023).",
  },
  has_foreign_operations: {
    question_de:
      "Hat die Körperschaft ausländische Tochtergesellschaften oder ausländische Einkünfte?",
    impact_de: "Steuert, ob Anlage AESt und/oder Anlage AEV benötigt werden.",
  },
  has_economic_business_activity: {
    question_de:
      "Werden steuerpflichtige wirtschaftliche Geschäftsbetriebe ausgeübt (für gemeinnützige Körperschaften relevant)?",
    impact_de:
      "Steuert die Pflicht zur Übermittlung der Anlagen GK und ZVE bei steuerbegünstigten Körperschaften.",
  },
  is_organschaft_subsidiary: {
    question_de: "Ist die Körperschaft Organgesellschaft in einer ertragsteuerlichen Organschaft?",
    impact_de: "Steuert, ob Anlage OG benötigt wird.",
  },
  is_organschaft_parent: {
    question_de: "Ist die Körperschaft Organträgerin in einer ertragsteuerlichen Organschaft?",
    impact_de: "Steuert, ob Anlage OT benötigt wird.",
  },
  has_loss_carryforward: {
    question_de:
      "Bestehen verbleibende Verlustvorträge oder wurde im Veranlagungszeitraum ein Verlust erzielt?",
    impact_de:
      "Steuert, ob Anlage Verluste relevant ist und ob Verlustfeststellungen geprüft werden müssen.",
  },
};

export const GewstProfileSchema = z.object({
  legal_form: z
    .enum(["GmbH", "UG", "AG", "SE", "KGaA", "OHG", "KG", "GbR", "Einzelunternehmer", "other"])
    .nullable(),
  fiscal_year_end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date YYYY-MM-DD")
    .nullable(),
  has_multiple_municipalities: z.boolean().nullable(),
  has_spartentrennung: z.boolean().nullable(),
  is_tax_privileged: z.boolean().nullable(),
  has_organschaft: z.boolean().nullable(),
});
export type GewstProfile = z.infer<typeof GewstProfileSchema>;

export const GewstProfileMeta: Record<keyof GewstProfile, ProfileFieldMeta> = {
  legal_form: {
    question_de: "Welche Rechtsform hat das gewerbesteuerpflichtige Unternehmen?",
    impact_de: "Bestimmt, welcher Vordruck zu verwenden ist und ob Sondertatbestände greifen.",
  },
  fiscal_year_end: {
    question_de: "Wann endet der Erhebungszeitraum (Format JJJJ-MM-TT)?",
    impact_de: "Notwendig für Abgabefristen.",
  },
  has_multiple_municipalities: {
    question_de:
      "Wird der Gewerbeertrag auf mehrere Gemeinden zerlegt (Betriebsstätten in verschiedenen Gemeinden)?",
    impact_de: "Steuert, ob Anlage Zerlegung (EMU) benötigt wird.",
  },
  has_spartentrennung: {
    question_de: "Sind Tätigkeiten in Sparten zu trennen (typisch für Betriebe gewerblicher Art)?",
    impact_de: "Steuert, ob Anlage HG / ÖHG zur Spartentrennung benötigt wird.",
  },
  is_tax_privileged: {
    question_de:
      "Ist das Unternehmen gemeinnützig, mildtätig oder kirchlich anerkannt und beantragt eine Gewerbesteuerbefreiung?",
    impact_de: "Steuert, ob die Anlage BEG (Befreiungen/Vergünstigungen) zu übermitteln ist.",
  },
  has_organschaft: {
    question_de:
      "Besteht eine gewerbesteuerliche Organschaft (Organträger- oder Organgesellschaftsstellung)?",
    impact_de:
      "Steuert spezifische Eintragungen im Hauptvordruck zur Zurechnung von Erträgen aus Organschaften.",
  },
};

export const UstProfileSchema = z.object({
  legal_form: z
    .enum(["GmbH", "UG", "AG", "OHG", "KG", "GbR", "Einzelunternehmer", "Verein", "other"])
    .nullable(),
  is_small_business: z.boolean().nullable(),
  has_intra_community_supplies: z.boolean().nullable(),
  has_fiscal_representation: z.boolean().nullable(),
});
export type UstProfile = z.infer<typeof UstProfileSchema>;

export const UstProfileMeta: Record<keyof UstProfile, ProfileFieldMeta> = {
  legal_form: {
    question_de: "Welche Rechtsform hat das umsatzsteuerpflichtige Unternehmen?",
    impact_de: "Bestimmt, welcher Vordruck zu verwenden ist.",
  },
  is_small_business: {
    question_de: "Wird die Kleinunternehmerregelung nach § 19 UStG in Anspruch genommen?",
    impact_de: "Steuert die Erklärungsart und ggf. Verzichtserklärungen.",
  },
  has_intra_community_supplies: {
    question_de: "Werden innergemeinschaftliche Lieferungen erbracht?",
    impact_de: "Steuert Pflichtfelder im Hauptvordruck und ggf. Anlage UN.",
  },
  has_fiscal_representation: {
    question_de: "Wird die Erklärung über einen Fiskalvertreter abgegeben?",
    impact_de: "Steuert, ob Anlage FV benötigt wird.",
  },
};

export type ProfileShape = KstProfile | GewstProfile | UstProfile;

export interface ProfileDefinition {
  taxType: TaxType;
  schema: z.ZodTypeAny;
  /** Field metadata keyed by field name. */
  meta: Record<string, ProfileFieldMeta>;
  /** Default profile: every required field set to null. */
  emptyProfile: () => Record<string, unknown>;
  /** Field names in declaration order — preserved when emitting open
   *  questions so the UI prompts the user in a deterministic sequence. */
  fieldOrder: readonly string[];
}

export const PROFILE_DEFINITIONS: Record<TaxType, ProfileDefinition> = {
  kst: {
    taxType: "kst",
    schema: KstProfileSchema,
    meta: KstProfileMeta,
    emptyProfile: () => ({
      legal_form: null,
      business_type: null,
      fiscal_year_end: null,
      has_foreign_operations: null,
      has_economic_business_activity: null,
      is_organschaft_subsidiary: null,
      is_organschaft_parent: null,
      has_loss_carryforward: null,
    }),
    fieldOrder: Object.keys(KstProfileMeta),
  },
  gewst: {
    taxType: "gewst",
    schema: GewstProfileSchema,
    meta: GewstProfileMeta,
    emptyProfile: () => ({
      legal_form: null,
      fiscal_year_end: null,
      has_multiple_municipalities: null,
      has_spartentrennung: null,
      is_tax_privileged: null,
      has_organschaft: null,
    }),
    fieldOrder: Object.keys(GewstProfileMeta),
  },
  ust: {
    taxType: "ust",
    schema: UstProfileSchema,
    meta: UstProfileMeta,
    emptyProfile: () => ({
      legal_form: null,
      is_small_business: null,
      has_intra_community_supplies: null,
      has_fiscal_representation: null,
    }),
    fieldOrder: Object.keys(UstProfileMeta),
  },
};
