import { useEffect, useMemo, useRef, useState } from "react";
import { getPassClient } from "./client";
import { Color, Icon, List, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { originOf, useActiveTab } from "../raycast/useActiveTab";
import { LoginItem } from "./types";

export function useVaultItems(vaultName: string | null) {
  const { activeOrigin } = useActiveTab();
  const [totpByItemId, setTotpByItemId] = useState<Record<string, string>>({});
  const [remainingSeconds, setRemainingSeconds] = useState(getTotpRemainingSeconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    data: rawItems,
    isLoading,
    error,
    revalidate,
  } = usePromise(async () => {
    const client = getPassClient();
    return await client.getItems(vaultName);
  });

  useEffect(() => {
    if (!rawItems) {
      setTotpByItemId({});
      return;
    }

    // Remove stale entries for items that no longer exist
    const validIds = new Set(rawItems.map((item) => item.id));
    setTotpByItemId((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => validIds.has(id))));

    const itemsWithTotp = rawItems.filter(
      (item): item is LoginItem & { totpUri: string; shareId: string } =>
        item.type === "Login" && !!item.totpUri && !!item.shareId,
    );

    if (itemsWithTotp.length === 0) return;

    let cancelled = false;
    const client = getPassClient();

    async function fetchTotpCodes() {
      for (const item of itemsWithTotp) {
        if (cancelled) break;

        const totp = await client.getItemTotp(item.shareId, item.id);
        if (cancelled || !totp) continue;

        setTotpByItemId((prev) => (prev[item.id] === totp ? prev : { ...prev, [item.id]: totp }));
      }
    }

    void fetchTotpCodes();
    return () => {
      cancelled = true;
    };
  }, [rawItems]);

  // Countdown timer: update every second and re-fetch TOTP codes on 30s boundary
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const seconds = getTotpRemainingSeconds();
      setRemainingSeconds(seconds);

      if (seconds === 30) {
        setTotpByItemId({});
        revalidate();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const items = useMemo(() => {
    if (!rawItems) return rawItems;

    return rawItems
      .map((item) => {
        const totp = item.totp ?? totpByItemId[item.id];
        const resolvedItem = totp != null ? { ...item, totp } : item;

        let icon = Icon.Lock;
        let isActiveOrigin = false;
        const clips: Clip[] = [];
        const accessories: List.Item.Accessory[] = [];

        const pushIf = (key: string, value: string | undefined, confidential: boolean = false) => {
          if (value) clips.push({ title: toTitle(key), content: value, confidential });
        };

        switch (resolvedItem.type) {
          case "Login":
            pushIf("password", resolvedItem.password, true);
            pushIf("email", resolvedItem.email);
            pushIf("username", resolvedItem.username);
            pushIf("totp", resolvedItem.totp, true);
            isActiveOrigin = resolvedItem.urls?.some((u) => originOf(u) === activeOrigin) ?? false;

            if (resolvedItem.urls?.[0]) {
              try {
                const url = new URL(resolvedItem.urls[0]);
                accessories.push({ text: url.hostname, tooltip: resolvedItem.urls[0] });
              } catch {
                accessories.push({ text: resolvedItem.urls[0], tooltip: resolvedItem.urls[0] });
              }
            }
            break;
          case "Identity":
            icon = Icon.Person;
            pushIf("full_name", resolvedItem.full_name);
            pushIf("email", resolvedItem.email);
            pushIf("phone_number", resolvedItem.phone_number);
            pushIf("street_address", resolvedItem.street_address);
            pushIf("zip_or_postal_code", resolvedItem.zip_or_postal_code);
            pushIf("first_name", resolvedItem.first_name);
            pushIf("middle_name", resolvedItem.middle_name);
            pushIf("last_name", resolvedItem.last_name);
            pushIf("birthdate", resolvedItem.birthdate);
            pushIf("gender", resolvedItem.gender);
            pushIf("organization", resolvedItem.organization);
            break;
          case "CreditCard":
            icon = Icon.CreditCard;
            pushIf("number", resolvedItem.number, true);
            pushIf("verification_number", resolvedItem.verification_number, true);
            pushIf("expiration_date", resolvedItem.expiration_date, true);
            pushIf("cardholder_name", resolvedItem.cardholder_name);
            pushIf("card_type", resolvedItem.card_type);
            break;
          case "SSHKey":
            icon = Icon.Key;
            pushIf("public_key", resolvedItem.public_key);
            pushIf("private_key", resolvedItem.private_key, true);
            break;
        }

        if (resolvedItem.totp) {
          const timerColor = remainingSeconds > 10 ? Color.Green : remainingSeconds > 5 ? Color.Yellow : Color.Red;
          accessories.unshift(
            { tag: { value: formatTotpCode(resolvedItem.totp), color: timerColor }, tooltip: "TOTP" },
            { text: `${remainingSeconds}s`, icon: Icon.Clock },
          );
        }

        if (isActiveOrigin) {
          accessories.push({ icon: Icon.Globe, tooltip: "Active website" });
        }

        if (resolvedItem.vaultTitle) {
          accessories.push({ text: resolvedItem.vaultTitle, tooltip: "Vault" });
        }

        return {
          ...resolvedItem,
          icon,
          isActiveOrigin,
          accessories,
          clipboardElements: clips,
        };
      })
      .sort((a, b) => {
        const aMatches =
          a.type === "Login" && Array.isArray(a.urls) && a.urls.some((u) => originOf(u) === activeOrigin);

        const bMatches =
          b.type === "Login" && Array.isArray(b.urls) && b.urls.some((u) => originOf(u) === activeOrigin);

        if (aMatches === bMatches) return 0;
        return aMatches ? -1 : 1;
      });
  }, [rawItems, activeOrigin, totpByItemId, remainingSeconds]);

  useEffect(() => {
    if (error) showToast(Toast.Style.Failure, "Error", error.message || "Something went wrong");
  }, [error]);

  return { items, isLoading, error, revalidate };
}

// -- Utilities

type Clip = { title: string; content: string; confidential?: boolean };

const toTitle = (key: string) => {
  // Special cases first
  switch (key) {
    case "verification_number":
      return "Verification Number";
    case "zip_or_postal_code":
      return "ZIP/Postal Code";
    case "cardholder_name":
      return "Cardholder Name";
    case "card_type":
      return "Card Type";
    case "public_key":
      return "Public Key";
    case "private_key":
      return "Private Key";
    case "full_name":
      return "Full Name";
    case "first_name":
      return "First Name";
    case "middle_name":
      return "Middle Name";
    case "last_name":
      return "Last Name";
    case "phone_number":
      return "Phone Number";
    case "street_address":
      return "Street Address";
    case "expiration_date":
      return "Expiration Date";
    default:
      // Generic: snake_case or camelCase to Title Case
      return key
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^\w|\s\w/g, (m) => m.toUpperCase());
  }
};

function getTotpRemainingSeconds(): number {
  const now = Math.floor(Date.now() / 1000);
  return 30 - (now % 30);
}

function formatTotpCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
