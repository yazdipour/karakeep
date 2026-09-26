import { eq } from "drizzle-orm";

import type { DB } from "@karakeep/db";
import { ttsProviderConfig } from "@karakeep/db/schema";

export const TTS_PROVIDER_CONFIG_ID = "default";

export interface TtsProviderConfig {
  provider: "kokoro";
  baseUrl: string;
  apiKey: string | null;
  model: string;
  voice: string;
}

export class TtsProviderConfigService {
  static async get(db: DB): Promise<TtsProviderConfig | null> {
    const row = await db.query.ttsProviderConfig.findFirst({
      where: eq(ttsProviderConfig.id, TTS_PROVIDER_CONFIG_ID),
    });
    return row ?? null;
  }

  // apiKey undefined/empty keeps whatever key (if any) is already stored, so
  // the admin form never needs to display or resubmit the existing secret.
  static async set(
    db: DB,
    input: {
      provider: "kokoro";
      baseUrl: string;
      apiKey?: string;
      model: string;
      voice: string;
    },
  ): Promise<void> {
    const existing = await this.get(db);
    const apiKey = input.apiKey ? input.apiKey : (existing?.apiKey ?? null);

    await db
      .insert(ttsProviderConfig)
      .values({
        id: TTS_PROVIDER_CONFIG_ID,
        provider: input.provider,
        baseUrl: input.baseUrl,
        apiKey,
        model: input.model,
        voice: input.voice,
      })
      .onConflictDoUpdate({
        target: ttsProviderConfig.id,
        set: {
          provider: input.provider,
          baseUrl: input.baseUrl,
          apiKey,
          model: input.model,
          voice: input.voice,
        },
      });
  }
}
