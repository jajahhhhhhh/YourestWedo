// Automatic slip check with EasySlip (https://document.easyslip.com/en/v2/).
// The pay page reads the QR printed on the bank slip; this asks EasySlip
// (which asks the bank) for the real transfer and compares it with the
// payment link:
//   - the amount must equal the link's amount
//   - the slip must not have been used before (EasySlip duplicate check)
//   - the receiver must be ours: either an account registered in EasySlip
//     (EASYSLIP_MATCH_ACCOUNT = "1"), or a receiver name that contains the
//     first name in SLIP_RECEIVER_NAME / PROMPTPAY_NAME
// Needs EASYSLIP_KEY (Cloudflare secret). Without it, or when EasySlip
// can't answer, slips fall back to the admin's ✅/❌ buttons.

const TITLES = /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|ms\.?|miss)\s*/i;

export function firstName(name) {
  return String(name || "").trim().replace(TITLES, "").split(/\s+/)[0] || "";
}

function baht(n) { return "฿" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }); }

// Returns { status: "ok" | "reject" | "unavailable", reason, th, slip }
//   reason: English text for the customer, th: Thai text for the team
export async function checkSlip(env, { qr, amount }) {
  if (!env.EASYSLIP_KEY) return { status: "unavailable", th: "ยังไม่ได้ตั้งค่าระบบตรวจสลิป" };
  if (!qr) return { status: "unavailable", th: "อ่าน QR บนสลิปไม่ได้ ระบบตรวจอัตโนมัติไม่ได้" };
  const expected = Number(amount);
  const api = (env.EASYSLIP_URL || "https://api.easyslip.com/v2").replace(/\/+$/, "");
  let res, body;
  try {
    res = await fetch(api + "/verify/bank", {
      method: "POST",
      headers: { authorization: "Bearer " + String(env.EASYSLIP_KEY).trim(), "content-type": "application/json" },
      body: JSON.stringify({
        payload: qr,
        matchAmount: expected,
        checkDuplicate: true,
        matchAccount: env.EASYSLIP_MATCH_ACCOUNT === "1",
      }),
    });
    body = await res.json();
  } catch (e) {
    console.error("EasySlip failed", String(e));
    return { status: "unavailable", th: "ระบบตรวจสลิปไม่ตอบ" };
  }

  if (!body || !body.success) {
    const code = body && body.error && body.error.code;
    console.error("EasySlip error", res && res.status, code, body && body.error && body.error.message);
    if (code === "SLIP_NOT_FOUND") {
      return { status: "reject", reason: "We couldn't find this transfer at the bank. Please check the slip and try again.", th: "ธนาคารไม่พบรายการโอนนี้" };
    }
    if (code === "SLIP_PENDING") return { status: "unavailable", th: "ธนาคารยังไม่ยืนยันรายการ (โอนไม่ถึง 5 นาที)" };
    if (code === "VALIDATION_ERROR") return { status: "unavailable", th: "QR บนสลิปไม่ถูกรูปแบบ" };
    return { status: "unavailable", th: "ระบบตรวจสลิปใช้ไม่ได้ (" + (code || "HTTP " + (res && res.status)) + ")" };
  }

  const d = body.data || {};
  const raw = d.rawSlip || {};
  const slipAmount = raw.amount && typeof raw.amount.amount === "number" ? raw.amount.amount
    : typeof d.amountInSlip === "number" ? d.amountInSlip : null;
  const rcv = (raw.receiver && raw.receiver.account) || {};
  const rcvNames = [rcv.name && rcv.name.th, rcv.name && rcv.name.en].filter(Boolean);
  const slip = { amount: slipAmount, receiver: rcvNames[0] || "", transRef: raw.transRef || "", date: raw.date || "" };

  if (d.isDuplicate) {
    return { status: "reject", slip, reason: "This slip has already been used. Please send the slip for this payment.", th: "สลิปนี้เคยถูกใช้แล้ว (สลิปซ้ำ)" };
  }
  if (d.isAmountMatched === false || (slipAmount !== null && Math.abs(slipAmount - expected) > 0.009)) {
    const got = slipAmount !== null ? baht(slipAmount) : "a different amount";
    return {
      status: "reject", slip,
      reason: "The slip shows " + got + " but this payment is " + baht(expected) + ". Please pay the exact amount.",
      th: "ยอดในสลิป " + (slipAmount !== null ? baht(slipAmount) : "ไม่ตรง") + " ไม่ตรงกับ " + baht(expected),
    };
  }
  if (env.EASYSLIP_MATCH_ACCOUNT === "1") {
    if (!d.matchedAccount) {
      return { status: "reject", slip, reason: "This transfer didn't go to our account. Please pay with the QR on this page.", th: "ผู้รับเงินไม่ใช่บัญชีของเรา" };
    }
  } else {
    const want = firstName(env.SLIP_RECEIVER_NAME || env.PROMPTPAY_NAME);
    if (want && rcvNames.length && !rcvNames.some((n) => n.toLowerCase().includes(want.toLowerCase()))) {
      return { status: "reject", slip, reason: "This transfer didn't go to our account. Please pay with the QR on this page.", th: "ผู้รับเงินในสลิป (" + rcvNames[0] + ") ไม่ใช่ " + want };
    }
  }
  return { status: "ok", slip, th: "ยอด " + baht(expected) + " ตรง · ผู้รับ " + (slip.receiver || "-") + " · ไม่ซ้ำ" };
}
