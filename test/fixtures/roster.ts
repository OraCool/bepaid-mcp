import ExcelJS from "exceljs";

// Synthetic roster reproducing the quirks of the real roster workbook (no real personal data).
// Rows of the optional "Модули" sheet: [Группа, Встреча, Дата, Цена, Валюта].
export type ModuleRow = (string | number | Date | null)[];

export interface RosterExtras {
  programs?: Record<string, string>; // group code -> value of the "Программа" column
  manualRows?: (string | number | null)[][]; // [UID транзакции, Группа, Плательщик, Встреча]
}

export function buildRosterWorkbook(moduleRows?: ModuleRow[], extras: RosterExtras = {}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();

  const groups = wb.addWorksheet("Groups");
  groups.addRow(["Группа", "Дата начала", "Дата окончания", "Основная локация", "Тип", "Основной свособ оплаты", "Программа"]);
  const program = (code: string) => extras.programs?.[code] ?? null;
  groups.addRow(["Альфа-25.1", null, null, "Belarus", "Обучение", "https://pay.example.by/payment/price?trainingId=x", program("Альфа-25.1")]);
  groups.addRow(["Альфа-25.1", null, null, "EU+", "Обучение", "https://buy.stripe.com/abc", null]);
  groups.addRow(["Бета 25", null, null, "Belarus", "Обучение", "https://pay.example.by/payment/price", program("Бета 25")]);

  // Sheet name differs from the code in B1; header on row 3.
  const alpha = wb.addWorksheet("Альфа 25.1");
  alpha.getCell("A1").value = "Группа:";
  alpha.getCell("B1").value = "Альфа-25.1";
  alpha.getRow(3).values = [
    "Обучающийся", "Тип", "Cпособ оплаты", "First Name + Last Name", "Имя Фамилия Отчество",
    "Country", "City", "Postal index", "Address", "Email", "Phone", "Телеграм ник", "NIP",
  ];
  alpha.getRow(4).values = [
    "Анна Иванова", "Обучение",
    { formula: "INDEX(Groups!F:F,2)", result: "https://pay.example.by/payment/price?trainingId=x" },
    "Anna Ivanova", "Иванова Анна Сергеевна", "Belarus", "Minsk", "", "", " Anna.Ivanova@Mail.ru ", 375291112233, "@anna",
  ];
  alpha.getRow(5).values = [
    "Ольга Петрова", "Обучение", "https://buy.stripe.com/abc",
    "Olga Petrova", "Петрова Ольга", "Lithuania", "Vilnius", "", "", "olga@example.com", "+370 600 00000", "@olga",
  ];
  alpha.getRow(6).values = []; // empty row is skipped

  // Extra column shifts everything right; header typo "Телергам ник".
  const beta = wb.addWorksheet("Бета 25");
  beta.getCell("B1").value = "Бета 25";
  beta.getRow(3).values = [
    "Плательщик", "Тип", "Cпособ оплаты", "Буду оплачивать", "First Name + Last Name", "Имя Фамилия Отчество",
    "Country", "City", "Postal index", "Address", "Email", "Phone", "Телергам ник", "NIP",
  ];
  // Same person as in Альфа-25.1 -> a payment by this email is ambiguous between groups.
  beta.getRow(4).values = [
    "Анна Иванова", "Обучение", "https://checkout.bepaid.by/v2/confirm_order/prd_1/1", "помодульно",
    "Anna Ivanova", "", "Belarus", "Minsk", "", "", "anna.ivanova@mail.ru", "8029 111-22-33", "@anna",
  ];
  beta.getRow(5).values = [
    "Мария Сидорова", "Обучение", "https://pay.example.by/payment/price", "",
    "Maria Sidorova", "", "Belarus", "Gomel", "", "", "", "+375 44 765 43 21", "@masha",
  ];

  if (moduleRows) {
    const modules = wb.addWorksheet("Модули");
    modules.addRow(["Группа", "Встреча", "Дата", "Цена", "Валюта"]);
    for (const row of moduleRows) modules.addRow(row);
  }

  if (extras.manualRows) {
    const manual = wb.addWorksheet("Ручные сопоставления");
    manual.addRow(["UID транзакции", "Группа", "Плательщик", "Встреча", "Комментарий"]);
    for (const row of extras.manualRows) manual.addRow(row);
  }

  // Non-group sheets must be ignored.
  wb.addWorksheet("Sheet2").addRow(["Payment Type", "Origin", "Link", "Type"]);
  wb.addWorksheet("Sheet1").getRow(3).values = [null, null, 3.2578, 160];
  return wb;
}
