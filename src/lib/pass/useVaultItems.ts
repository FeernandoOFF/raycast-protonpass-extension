import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPassClient } from "./client";
import { Color, Icon, List, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { originOf, useActiveTab } from "../raycast/useActiveTab";
import { Item, ItemField, ItemSummary, ItemType } from "./types";

// Lightweight list row — built from `item list` metadata only (no secrets).
export type DisplaySummary = ItemSummary & {
  icon: Icon;
  accessories: List.Item.Accessory[];
};

// Fully-loaded item used by the detail view — content fetched lazily via `item view`.
export type DisplayItem = Item & {
  clipboardElements: ItemField[];
};

export function useVaultItems(vaultName: string | null) {
  const {
    data: summaries,
    isLoading,
    error,
    revalidate,
  } = usePromise(async () => {
    const client = getPassClient();
    return await client.getItems(vaultName);
  });

  const items = useMemo(() => {
    if (!summaries) return summaries;

    return summaries.map(
      (summary) =>
        ({
          ...summary,
          icon: iconForItem(summary.type),
          accessories: buildSummaryAccessories(summary),
        }) satisfies DisplaySummary,
    );
  }, [summaries]);

  useEffect(() => {
    if (error) showToast(Toast.Style.Failure, "Error", error.message || "Something went wrong");
  }, [error]);

  return { items, isLoading, error, revalidate };
}

// Lazily loads a single item's full content (and live TOTP) when its detail is opened.
export function useItemDetail(summary: ItemSummary) {
  const { activeOrigin } = useActiveTab();
  const [totp, setTotp] = useState<string | undefined>();
  const [remainingSeconds, setRemainingSeconds] = useState(getTotpRemainingSeconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    data: rawItem,
    isLoading,
    error,
    revalidate,
  } = usePromise(async () => {
    if (!summary.shareId) return null;
    return await getPassClient().getItem(summary.shareId, summary.id);
  });

  // Fetch TOTP once the login item is loaded.
  useEffect(() => {
    setTotp(undefined);
    if (!rawItem || rawItem.type !== "Login" || !rawItem.totpUri || !rawItem.shareId) return;

    let cancelled = false;
    void getPassClient()
      .getItemTotp(rawItem.shareId, rawItem.id)
      .then((code) => {
        if (!cancelled && code) setTotp(code);
      });

    return () => {
      cancelled = true;
    };
  }, [rawItem]);

  // Countdown timer; refetch TOTP on each 30s boundary.
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const seconds = getTotpRemainingSeconds();
      setRemainingSeconds(seconds);

      if (seconds === 30 && rawItem?.type === "Login" && rawItem.totpUri && rawItem.shareId) {
        void getPassClient()
          .getItemTotp(rawItem.shareId, rawItem.id)
          .then((code) => code && setTotp(code));
      }
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [rawItem]);

  const item = useMemo<DisplayItem | null>(() => {
    if (!rawItem) return null;

    const resolved = totp != null ? { ...rawItem, totp } : rawItem;
    return { ...resolved, clipboardElements: buildClipboardElements(resolved) } satisfies DisplayItem;
  }, [rawItem, totp]);

  const isActiveOrigin = item?.type === "Login" && (item.urls?.some((u) => originOf(u) === activeOrigin) ?? false);

  useEffect(() => {
    if (error) showToast(Toast.Style.Failure, "Failed to load item", error.message || "Something went wrong");
  }, [error]);

  return { item, isLoading, error, remainingSeconds, isActiveOrigin, revalidate };
}

// Prefetches the highlighted list row's content (and live TOTP) so the action panel
// is fully populated and the detail view opens instantly. Wire up to List.onSelectionChange.
const PREFETCH_DEBOUNCE_MS = 250;

export function useItemPrefetch(items?: DisplaySummary[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contentById, setContentById] = useState<Record<string, DisplayItem | null>>({});
  const [totpById, setTotpById] = useState<Record<string, string>>({});
  const [remainingSeconds, setRemainingSeconds] = useState(getTotpRemainingSeconds);
  const [knownTotpIds, setKnownTotpIds] = useState<Set<string>>(() => new Set(getPassClient().getTotpItemIds()));
  const inflight = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTotp = useCallback(async (item: DisplayItem) => {
    if (item.type !== "Login" || !item.totpUri || !item.shareId) return;
    const code = await getPassClient().getItemTotp(item.shareId, item.id);
    if (code) setTotpById((prev) => (prev[item.id] === code ? prev : { ...prev, [item.id]: code }));
  }, []);

  const prefetch = useCallback(
    async (summary: ItemSummary) => {
      if (!summary.shareId || contentById[summary.id] !== undefined || inflight.current.has(summary.id)) return;

      inflight.current.add(summary.id);
      try {
        const full = await getPassClient().getItem(summary.shareId, summary.id);
        const display = full
          ? ({ ...full, clipboardElements: buildClipboardElements(full) } satisfies DisplayItem)
          : null;
        setContentById((prev) => ({ ...prev, [summary.id]: display }));
        if (display?.type === "Login" && display.totpUri) {
          setKnownTotpIds((prev) => (prev.has(summary.id) ? prev : new Set(prev).add(summary.id)));
          void fetchTotp(display);
        }
      } catch {
        // best-effort prefetch; the detail view surfaces real errors on open
      } finally {
        inflight.current.delete(summary.id);
      }
    },
    [contentById, fetchTotp],
  );

  // Debounce prefetch so arrowing quickly through the list doesn't fire a `item view`
  // per row — only the row the selection settles on is fetched.
  const onSelectionChange = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (debounceRef.current) clearTimeout(debounceRef.current);

      const summary = id ? items?.find((item) => item.id === id) : undefined;
      if (!summary) return;

      debounceRef.current = setTimeout(() => void prefetch(summary), PREFETCH_DEBOUNCE_MS);
    },
    [items, prefetch],
  );

  useEffect(() => () => void (debounceRef.current && clearTimeout(debounceRef.current)), []);

  // Countdown timer; refresh the selected login's TOTP on each 30s boundary.
  useEffect(() => {
    const interval = setInterval(() => {
      const seconds = getTotpRemainingSeconds();
      setRemainingSeconds(seconds);

      if (seconds === 30 && selectedId) {
        const content = contentById[selectedId];
        if (content) void fetchTotp(content);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [selectedId, contentById, fetchTotp]);

  return { onSelectionChange, selectedId, contentById, totpById, remainingSeconds, knownTotpIds };
}

// -- Builders

// Merge a live TOTP code into a loaded login so its clipboard actions include it.
export function withTotp(item: DisplayItem, totp?: string): DisplayItem {
  if (!totp || item.type !== "Login") return item;
  const resolved = { ...item, totp };
  return { ...resolved, clipboardElements: buildClipboardElements(resolved) };
}

function buildSummaryAccessories(summary: ItemSummary): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];

  if (summary.state === "Trashed") {
    accessories.push({ icon: { source: Icon.Trash, tintColor: Color.SecondaryText }, tooltip: "Trashed" });
  }
  if (summary.vaultTitle) {
    accessories.push({ text: summary.vaultTitle, tooltip: "Vault" });
  }

  return accessories;
}

function buildClipboardElements(item: Item): ItemField[] {
  const clips: ItemField[] = [];

  switch (item.type) {
    case "Login":
      pushClipIf(clips, "email", item.email);
      pushClipIf(clips, "password", item.password, true);
      pushClipIf(clips, "username", item.username);
      pushClipIf(clips, "totp", item.totp, true);
      break;
    case "Identity":
      pushClipIf(clips, "email", item.email);
      pushClipIf(clips, "full_name", item.full_name);
      pushClipIf(clips, "phone_number", item.phone_number);
      pushClipIf(clips, "street_address", item.street_address);
      pushClipIf(clips, "zip_or_postal_code", item.zip_or_postal_code);
      pushClipIf(clips, "city", item.city);
      pushClipIf(clips, "state_or_province", item.state_or_province);
      pushClipIf(clips, "country_or_region", item.country_or_region);
      pushClipIf(clips, "first_name", item.first_name);
      pushClipIf(clips, "middle_name", item.middle_name);
      pushClipIf(clips, "last_name", item.last_name);
      pushClipIf(clips, "birthdate", item.birthdate);
      pushClipIf(clips, "gender", item.gender);
      pushClipIf(clips, "organization", item.organization);
      pushClipIf(clips, "company", item.company);
      pushClipIf(clips, "job_title", item.job_title);
      pushClipIf(clips, "website", item.website);
      pushClipIf(clips, "personal_website", item.personal_website);
      pushClipIf(clips, "work_email", item.work_email);
      pushClipIf(clips, "work_phone_number", item.work_phone_number);
      pushClipIf(clips, "social_security_number", item.social_security_number, true);
      pushClipIf(clips, "passport_number", item.passport_number, true);
      pushClipIf(clips, "license_number", item.license_number, true);
      break;
    case "CreditCard":
      pushClipIf(clips, "number", item.number, true);
      pushClipIf(clips, "verification_number", item.verification_number, true);
      pushClipIf(clips, "expiration_date", item.expiration_date, true);
      pushClipIf(clips, "pin", item.pin, true);
      pushClipIf(clips, "cardholder_name", item.cardholder_name);
      pushClipIf(clips, "card_type", item.card_type);
      break;
    case "SSHKey":
      pushClipIf(clips, "public_key", item.public_key);
      pushClipIf(clips, "private_key", item.private_key, true);
      break;
    case "Note":
      pushClipIf(clips, "note", item.notes);
      break;
    case "Alias":
      pushClipIf(clips, "alias", item.title, true);
      break;
    case "Custom":
    case "Other":
      break;
  }

  pushUniqueFields(clips, item.extraFields);
  pushUniqueSectionFields(clips, item.sections);

  return clips;
}

// -- Utilities

function iconForItem(type: ItemType): Icon {
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

export function formatTotpCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
