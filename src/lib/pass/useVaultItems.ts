import { useEffect, useMemo, useRef, useState } from "react";
import { getPassClient } from "./client";
import { Color, Icon, List, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { originOf, useActiveTab } from "../raycast/useActiveTab";
import { Item, ItemField, LoginItem } from "./types";

export type DisplayItem = Item & {
  icon: Icon;
  isActiveOrigin: boolean;
  accessories: List.Item.Accessory[];
  clipboardElements: ItemField[];
};

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

        const icon = iconForItem(resolvedItem.type);
        let isActiveOrigin = false;
        const clips: ItemField[] = [];
        const accessories: List.Item.Accessory[] = [];

        switch (resolvedItem.type) {
          case "Login":
            pushClipIf(clips, "email", resolvedItem.email);
            pushClipIf(clips, "password", resolvedItem.password, true);
            pushClipIf(clips, "username", resolvedItem.username);
            pushClipIf(clips, "totp", resolvedItem.totp, true);
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
            pushClipIf(clips, "email", resolvedItem.email);
            pushClipIf(clips, "full_name", resolvedItem.full_name);
            pushClipIf(clips, "phone_number", resolvedItem.phone_number);
            pushClipIf(clips, "street_address", resolvedItem.street_address);
            pushClipIf(clips, "zip_or_postal_code", resolvedItem.zip_or_postal_code);
            pushClipIf(clips, "city", resolvedItem.city);
            pushClipIf(clips, "state_or_province", resolvedItem.state_or_province);
            pushClipIf(clips, "country_or_region", resolvedItem.country_or_region);
            pushClipIf(clips, "first_name", resolvedItem.first_name);
            pushClipIf(clips, "middle_name", resolvedItem.middle_name);
            pushClipIf(clips, "last_name", resolvedItem.last_name);
            pushClipIf(clips, "birthdate", resolvedItem.birthdate);
            pushClipIf(clips, "gender", resolvedItem.gender);
            pushClipIf(clips, "organization", resolvedItem.organization);
            pushClipIf(clips, "company", resolvedItem.company);
            pushClipIf(clips, "job_title", resolvedItem.job_title);
            pushClipIf(clips, "website", resolvedItem.website);
            pushClipIf(clips, "personal_website", resolvedItem.personal_website);
            pushClipIf(clips, "work_email", resolvedItem.work_email);
            pushClipIf(clips, "work_phone_number", resolvedItem.work_phone_number);
            pushClipIf(clips, "social_security_number", resolvedItem.social_security_number, true);
            pushClipIf(clips, "passport_number", resolvedItem.passport_number, true);
            pushClipIf(clips, "license_number", resolvedItem.license_number, true);
            break;
          case "CreditCard":
            pushClipIf(clips, "number", resolvedItem.number, true);
            pushClipIf(clips, "verification_number", resolvedItem.verification_number, true);
            pushClipIf(clips, "expiration_date", resolvedItem.expiration_date, true);
            pushClipIf(clips, "pin", resolvedItem.pin, true);
            pushClipIf(clips, "cardholder_name", resolvedItem.cardholder_name);
            pushClipIf(clips, "card_type", resolvedItem.card_type);
            break;
          case "SSHKey":
            pushClipIf(clips, "public_key", resolvedItem.public_key);
            pushClipIf(clips, "private_key", resolvedItem.private_key, true);
            break;
          case "Note":
            pushClipIf(clips, "note", resolvedItem.notes);
            break;
          case "Alias":
            pushClipIf(clips, "alias", resolvedItem.title, true);
            break;
          case "Custom":
          case "Other":
            break;
        }

        pushUniqueFields(clips, resolvedItem.extraFields);
        pushUniqueSectionFields(clips, resolvedItem.sections);

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
        } satisfies DisplayItem;
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

function iconForItem(type: Item["type"]): Icon {
  switch (type) {
    case "Identity":
      return Icon.Person;
    case "CreditCard":
      return Icon.CreditCard;
    case "SSHKey":
      return Icon.Key;
    case "Note":
      return Icon.Document;
    case "Alias":
      return Icon.AtSymbol;
    case "Custom":
      return Icon.List;
    case "Other":
      return Icon.QuestionMark;
    case "Login":
    default:
      return Icon.Lock;
  }
}

function pushClipIf(target: ItemField[], key: string, value: string | undefined, confidential: boolean = false) {
  if (value) {
    target.push({ title: toTitle(key), content: value, confidential });
  }
}

function pushUniqueFields(target: ItemField[], fields?: ItemField[]) {
  for (const field of fields ?? []) {
    if (!target.some((entry) => entry.title === field.title && entry.content === field.content)) {
      target.push(field);
    }
  }
}

function pushUniqueSectionFields(target: ItemField[], sections?: Item["sections"]) {
  for (const section of sections ?? []) {
    pushUniqueFields(target, section.fields);
  }
}

export const toTitle = (key: string) => {
  // Special cases first
  switch (key) {
    case "alias":
      return "Alias";
    case "note":
      return "Note";
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
    case "state_or_province":
      return "State/Province";
    case "country_or_region":
      return "Country/Region";
    case "social_security_number":
      return "Social Security Number";
    case "passport_number":
      return "Passport Number";
    case "license_number":
      return "License Number";
    case "x_handle":
      return "X Handle";
    case "work_phone_number":
      return "Work Phone Number";
    case "work_email":
      return "Work Email";
    case "personal_website":
      return "Personal Website";
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
