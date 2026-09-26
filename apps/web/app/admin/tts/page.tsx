import type { Metadata } from "next";
import TTSProviderSettings from "@/components/admin/TTSProviderSettings";
import { useTranslation } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  // oxlint-disable-next-line rules-of-hooks
  const { t } = await useTranslation();
  return {
    title: `${t("admin.tts.tts_settings")} | Karakeep`,
  };
}

export default function AdminTTSPage() {
  return (
    <div className="flex flex-col gap-6">
      <TTSProviderSettings />
    </div>
  );
}
