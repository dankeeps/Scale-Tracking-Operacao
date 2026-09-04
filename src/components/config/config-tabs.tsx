"use client";

import { AccountSection } from "@/components/config/account-section";
import { FunnelSection } from "@/components/config/funnel-section";
import { OutboundSection } from "@/components/config/outbound-section";
import { ProductsSection } from "@/components/config/products-section";
import { SettingsForm } from "@/components/config/settings-form";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ACCOUNT_KINDS, type AccountRow } from "@/lib/config/accounts";
import type { ProductRow } from "@/lib/config/products";
import type { OutboundConfig, OutboundRun } from "@/lib/outbound/send";

export function ConfigTabs({
  settings,
  pixels,
  ga4,
  adaccounts,
  products,
  outbound,
  outboundRuns,
}: {
  settings: {
    currency: string;
    test_event_code: string;
    webhook_token_mask: string | null;
    webhook_domain: string | null;
  };
  pixels: AccountRow[];
  ga4: AccountRow[];
  adaccounts: AccountRow[];
  products: ProductRow[];
  outbound: OutboundConfig;
  outboundRuns: OutboundRun[];
}) {
  return (
    <Tabs defaultValue="geral" className="w-full">
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 sm:w-fit">
        <TabsTrigger value="geral">Geral</TabsTrigger>
        <TabsTrigger value="envio">Webhook de saída</TabsTrigger>
        <TabsTrigger value="pixel">Pixels Meta</TabsTrigger>
        <TabsTrigger value="ga4">GA4</TabsTrigger>
        <TabsTrigger value="adaccount">Contas de anúncio</TabsTrigger>
        <TabsTrigger value="produtos">Produtos</TabsTrigger>
        <TabsTrigger value="funil">Funil</TabsTrigger>

      </TabsList>

      <TabsContent value="geral" className="mt-4">
        <SettingsForm settings={settings} />
      </TabsContent>
      <TabsContent value="envio" className="mt-4">
        <OutboundSection config={outbound} runs={outboundRuns} />
      </TabsContent>
      <TabsContent value="pixel" className="mt-4">
        <AccountSection meta={ACCOUNT_KINDS.pixel} items={pixels} />
      </TabsContent>
      <TabsContent value="ga4" className="mt-4">
        <AccountSection meta={ACCOUNT_KINDS.ga4} items={ga4} />
      </TabsContent>
      <TabsContent value="adaccount" className="mt-4">
        <AccountSection meta={ACCOUNT_KINDS.adaccount} items={adaccounts} />
      </TabsContent>
      <TabsContent value="produtos" className="mt-4">
        <ProductsSection products={products} />
      </TabsContent>
      <TabsContent value="funil" className="mt-4">
        <FunnelSection products={products} />
      </TabsContent>
    </Tabs>
  );
}
