// Normalization helpers used to compare bePaid customer data with the roster workbook.

export function normalizeEmail(email: string | null | undefined): string | undefined {
  const value = email?.trim().toLowerCase();
  return value?.includes("@") ? value : undefined;
}

// Phones in the roster look like "375291234567", "+375 29 123-45-67", "79001234567".
// Country prefixes are inconsistent, so we compare the last 9 digits (BY mobile = 9 digits after 375).
const PHONE_SUFFIX_LENGTH = 9;

export function normalizePhone(phone: string | number | null | undefined): string | undefined {
  if (phone === null || phone === undefined) return undefined;
  const digits = String(phone).replaceAll(/\D/g, "");
  return digits.length >= PHONE_SUFFIX_LENGTH ? digits.slice(-PHONE_SUFFIX_LENGTH) : undefined;
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  і: "i", ў: "u",
};

/** Lowercase ASCII transliteration: "Альфа-25.1" -> "alfa-25.1". */
export function transliterate(text: string): string {
  return [...text.toLowerCase()].map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch).join("");
}

/**
 * Name -> set of comparable tokens, independent of word order and script.
 * "Иванова Мария" and "MARIYA IVANOVA" both become {"ivanova", "maria"}.
 * Latin spellings differ ("ya" vs "ia"), so tokens are further simplified.
 */
export function nameTokens(name: string | null | undefined): Set<string> {
  if (!name) return new Set();
  return new Set(
    transliterate(name)
      .split(/[^a-z]+/)
      .filter((t) => t.length >= 2)
      .map(simplifyLatin),
  );
}

function simplifyLatin(token: string): string {
  return token
    .replaceAll("ya", "ia")
    .replaceAll("yu", "iu")
    .replaceAll("y", "i")
    .replaceAll(/(.)\1+/g, "$1");
}

// Belarusian passports transliterate the Belarusian form of a name (Volha, Iryna, Aliaksandra, Hleb),
// while the roster usually holds the Russian form (Ольга, Ирина, Александра, Глеб).
// Names whose Belarusian form differs beyond spelling are mapped explicitly (tokens as produced by nameTokens).
const NAME_ALIASES: Record<string, string> = {
  hana: "ana", // Hanna = Анна
  alena: "elena", // Alena = Елена
  mikalai: "nikolai", // Mikalai = Николай
  nadzeia: "nadezhda", // Nadzeya = Надежда
  alesia: "olesia", // Alesia = Олеся
};

const VOWELS = "aeiou";

/** Spelling-independent form: Belarusian h/dz/ts/ў and Russian g/d/t/в are unified. */
function phoneticForm(token: string): string {
  return (NAME_ALIASES[token] ?? token)
    .replaceAll("kh", "h")
    .replaceAll("h", "g")
    .replaceAll("dz", "d")
    .replaceAll("ts", "t")
    .replace(/^vo/, "o") // Volha = Ольга
    .replace(/^u(?=[^aeiou])/, "v") // Uladzimir = Владимир
    .replaceAll(/([aeiou])u(?=[^aeiou])/g, "$1v"); // Yauheni = Евгений
}

function consonants(token: string): string {
  return [...token].filter((ch) => !VOWELS.includes(ch)).join("");
}

/**
 * Whether two name tokens (from nameTokens) are spellings of the same name.
 * Consonant skeletons must agree and be at least 3 letters long, because vowels differ the most between
 * Belarusian and Russian forms (Aliaksandra / Aleksandra, Katsiaryna / Ekaterina) while short skeletons collide.
 */
export function similarNameTokens(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = phoneticForm(a);
  const pb = phoneticForm(b);
  if (pa === pb) return true;
  const ca = consonants(pa);
  return ca.length >= 3 && ca === consonants(pb);
}
