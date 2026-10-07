/**
 * ==============================================================================
 * Email Retention Alert System (ระบบติดตามและแจ้งเตือนเมลพนักงานลาออกครบ 3 เดือน)
 * ==============================================================================
 */

const CONFIG = {
  LINE_CHANNEL_ACCESS_TOKEN: PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '',
  LINE_TARGET_ID: PropertiesService.getScriptProperties().getProperty('LINE_TARGET_ID') || '',
  SHEET_MASTER: 'รายชื่อเมลพนักงาน',
  SHEET_RESIGNED: 'รายการเมลที่กำหนดออก',
  TIMEZONE: 'Asia/Bangkok'
};

// ==============================================================================
// 1. WEBHOOK HANDLERS (doGet & doPost)
// ==============================================================================
function doGet(e) {
  return ContentService.createTextOutput('Webhook is online').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
    }

    const data = JSON.parse(e.postData.contents);
    const events = data.events || [];

    if (events.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
    }

    for (const event of events) {
      if (event.type === 'join') {
        const groupId = event.source.groupId || event.source.roomId;
        if (groupId) {
          replyTextMessage(event.replyToken, `🆔 Group ID ของกลุ่มนี้คือ:\n${groupId}`);
        }
      } else if (event.type === 'message' && event.message.type === 'text') {
        handleIncomingLineMessage(event);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log('[doPost Error] ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ==============================================================================
// 2. MESSAGE ROUTER
// ==============================================================================
function handleIncomingLineMessage(event) {
  const userText = event.message.text.trim();
  const replyToken = event.replyToken;

  // 1. เมนู / คำสั่งช่วยเหลือ
  if (/^(?:เมนู|คำสั่ง|ช่วยเหลือ|help|ฟังก์ชัน|ฟังชั่น)$/i.test(userText)) {
    handleHelpCommand(replyToken);
    return;
  }

  // 2. ตรวจสอบ Group ID
  if (/^(?:getid|ไอดีกลุ่ม|เช็คไอดี|id)$/i.test(userText)) {
    const targetId = event.source.groupId || event.source.roomId || event.source.userId;
    replyTextMessage(replyToken, `🆔 ID:\n${targetId}`);
    return;
  }

  // 3. ครบกำหนดในเดือนนี้
  if (/^(?:กำหนด\s*(?:ใน\s*)?เดือนนี้(?:มีใครบ้าง)?|ครบกำหนดเดือนนี้(?:มีใครบ้าง)?|รายการเดือนนี้|เตือนเดือนนี้|เดือนนี้)$/i.test(userText)) {
    handleMonthDueListCommand(replyToken);
    return;
  }

  // 4. ยกเลิกลาออก (รองรับ: "ยกเลิก สมชาย", "ยกเลิกลาออก สมชาย", "ยกเลิกการลาออก สมชาย", "cancel สมชาย")
  const cancelMatch = userText.match(/^(?:ยกเลิก\s*(?:การ\s*)?(?:ลา\s*ออก)?(?:\s*ของ)?|cancel)\s*(.*)$/i);
  if (cancelMatch) {
    const query = cancelMatch[1].replace(/^[:\-\s]+/, '').trim();
    if (!query) {
      replyTextMessage(replyToken, 'ℹ️ กรุณาระบุชื่อ, อีเมล หรือรหัสพนักงานที่ต้องการยกเลิกค่ะ\nเช่น: ยกเลิก สมชาย หรือ ยกเลิก it.officer@regent-chaam.com');
      return;
    }
    handleCancelResignationCommand(query, replyToken);
    return;
  }

  // 5. เช็คสถานะ (รองรับ: "เช็คสถานะ สมชาย", "สถานะ สมชาย", "ดูสถานะ สมชาย", "เช็ค สมชาย", "status สมชาย")
  const statusMatch = userText.match(/^(?:เช็คสถานะ(?:\s*เมล)?(?:\s*ของ)?|ตรวจสถานะ(?:\s*เมล)?(?:\s*ของ)?|สถานะ(?:\s*เมล)?(?:\s*ของ)?|ดูสถานะ(?:\s*เมล)?(?:\s*ของ)?|เช็ค(?:\s*เมล)?|status|check)\s*(.*)$/i);
  if (statusMatch) {
    const query = statusMatch[1].replace(/^[:\-\s]+/, '').trim();
    if (!query) {
      replyTextMessage(replyToken, 'ℹ️ กรุณาระบุชื่อ, อีเมล หรือรหัสพนักงานที่ต้องการเช็คสถานะค่ะ\nเช่น: เช็คสถานะ สมชาย หรือ เช็คสถานะ it.officer@regent-chaam.com');
      return;
    }
    handleCheckStatusCommand(query, replyToken);
    return;
  }

  // 6. แจ้งลาออก (รองรับ: "สมชาย มีกำหนด ลาออก 08/12/2026" หรือ "แจ้งลาออก สมชาย 08/12/2026")
  const parsedResign = parseResignCommand(userText);
  if (parsedResign) {
    handleResignCommand(parsedResign, replyToken);
    return;
  }

  // 7. ข้อความอื่นๆ นอกเหนือจากคำสั่ง: ส่งเมนูกลับทันที
  handleHelpCommand(replyToken);
}

// ==============================================================================
// 3. CORE COMMAND HANDLERS
// ==============================================================================

/**
 * จัดการคำสั่งแจ้งลาออก
 */
function handleResignCommand(parsed, replyToken) {
  const { rawName, resignDate } = parsed;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName(CONFIG.SHEET_MASTER);
  const resignedSheet = ss.getSheetByName(CONFIG.SHEET_RESIGNED);

  if (!masterSheet || !resignedSheet) {
    replyTextMessage(replyToken, '❌ ไม่พบชีตข้อมูลในระบบ');
    return;
  }

  const found = findEmployee(masterSheet, resignedSheet, rawName);
  if (!found || !found.emp) {
    replyTextMessage(replyToken, `⚠️ ไม่พบรายชื่อ "${rawName}" ในฐานข้อมูล กรุณาตรวจสอบชื่อ-นามสกุล หรืออีเมลอีกครั้งค่ะ`);
    return;
  }

  const emp = found.emp;
  const nowStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

  // ปรับสถานะเมลในชีตหลักเป็น Inactive
  if (found.masterRowIndex) {
    masterSheet.getRange(found.masterRowIndex, 5).setValue('Inactive');
    masterSheet.getRange(found.masterRowIndex, 6).setValue(nowStr);
  }

  // คำนวณวันครบกำหนด 3 เดือน
  const dueDate = new Date(resignDate.getTime());
  dueDate.setMonth(dueDate.getMonth() + 3);

  const resignDateFormatted = Utilities.formatDate(resignDate, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const dueDateFormatted = Utilities.formatDate(dueDate, CONFIG.TIMEZONE, 'yyyy-MM-dd');

  // บันทึกลงชีตคิว
  resignedSheet.appendRow([
    emp.empId,
    emp.name,
    emp.email,
    emp.dept,
    resignDateFormatted,
    dueDateFormatted,
    'Pending',
    '',
    `บันทึกจากคำสั่งใน LINE (${nowStr})`
  ]);

  const bubble = buildConfirmationFlexBubble({
    name: emp.name,
    email: emp.email,
    dept: emp.dept,
    resignDateText: formatThaiDateDisplay(resignDate),
    dueDateText: formatThaiDateDisplay(dueDate),
    sheetUrl: ss.getUrl()
  });

  replyFlexMessage(replyToken, `✅ อัปเดตสถานะเมล ${emp.name} เป็น Inactive เรียบร้อยแล้วค่ะ`, bubble);
}

/**
 * จัดการคำสั่งยกเลิกลาออก
 */
function handleCancelResignationCommand(query, replyToken) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName(CONFIG.SHEET_MASTER);
  const resignedSheet = ss.getSheetByName(CONFIG.SHEET_RESIGNED);

  if (!masterSheet || !resignedSheet) {
    replyTextMessage(replyToken, '❌ ไม่พบชีตข้อมูลในระบบ');
    return;
  }

  const found = findEmployee(masterSheet, resignedSheet, query);
  if (!found || !found.emp) {
    replyTextMessage(replyToken, `⚠️ ไม่พบข้อมูลของ "${query}" ในระบบค่ะ`);
    return;
  }

  const emp = found.emp;
  const nowStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

  // 1. คืนสถานะในชีตหลักเป็น Active
  if (found.masterRowIndex) {
    masterSheet.getRange(found.masterRowIndex, 5).setValue('Active');
    masterSheet.getRange(found.masterRowIndex, 6).setValue(nowStr);
  }

  // 2. ยกเลิกรายการในชีตคิว
  let cancelledCount = 0;
  const resignedData = resignedSheet.getDataRange().getValues();
  const cleanQ = cleanSearchTerm(query);
  const cleanEmpName = cleanSearchTerm(emp.name);
  const cleanEmail = emp.email.toLowerCase().trim();

  for (let r = 1; r < resignedData.length; r++) {
    const rowEmpId = String(resignedData[r][0] || '').trim().toLowerCase();
    const rowName = cleanSearchTerm(resignedData[r][1]);
    const rowEmail = String(resignedData[r][2] || '').trim().toLowerCase();
    const rowStatus = String(resignedData[r][6] || '').trim().toLowerCase();

    const isMatch = (cleanEmail && rowEmail === cleanEmail) ||
                    (rowName && (rowName === cleanQ || rowName === cleanEmpName || rowName.includes(cleanQ) || cleanQ.includes(rowName))) ||
                    (emp.empId && emp.empId !== '-' && rowEmpId === emp.empId.toLowerCase());

    if (isMatch && rowStatus !== 'cancelled') {
      resignedSheet.getRange(r + 1, 7).setValue('Cancelled');
      resignedSheet.getRange(r + 1, 9).setValue(`ยกเลิกลาออกโดยคำสั่งใน LINE (${nowStr})`);
      cancelledCount++;
    }
  }

  const bubble = buildCancelConfirmationBubble({
    empId: emp.empId,
    name: emp.name,
    email: emp.email,
    dept: emp.dept,
    cancelledQueueCount: cancelledCount,
    sheetUrl: ss.getUrl()
  });

  replyFlexMessage(replyToken, `↩️ ยกเลิกการลาออกของ ${emp.name} สำเร็จแล้วค่ะ`, bubble);
}

/**
 * จัดการคำสั่งเช็คสถานะพนักงาน
 */
function handleCheckStatusCommand(query, replyToken) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName(CONFIG.SHEET_MASTER);
  const resignedSheet = ss.getSheetByName(CONFIG.SHEET_RESIGNED);

  if (!masterSheet || !resignedSheet) {
    replyTextMessage(replyToken, '❌ ไม่พบชีตข้อมูลในระบบ');
    return;
  }

  const found = findEmployee(masterSheet, resignedSheet, query);
  if (!found || !found.emp) {
    replyTextMessage(replyToken, `⚠️ ไม่พบข้อมูลของ "${query}" ในระบบค่ะ`);
    return;
  }

  const emp = found.emp;

  // ค้นหารายการลาออกล่าสุดจากชีตคิว
  let resignInfo = null;
  const resignedData = resignedSheet.getDataRange().getValues();
  const cleanQ = cleanSearchTerm(query);
  const cleanEmpName = cleanSearchTerm(emp.name);
  const cleanEmail = emp.email.toLowerCase().trim();

  for (let r = resignedData.length - 1; r >= 1; r--) {
    const rowEmpId = String(resignedData[r][0] || '').trim().toLowerCase();
    const rowName = cleanSearchTerm(resignedData[r][1]);
    const rowEmail = String(resignedData[r][2] || '').trim().toLowerCase();
    const rowStatus = String(resignedData[r][6] || '').trim();

    const isMatch = (cleanEmail && rowEmail === cleanEmail) ||
                    (rowName && (rowName === cleanQ || rowName === cleanEmpName || rowName.includes(cleanQ) || cleanQ.includes(rowName))) ||
                    (emp.empId && emp.empId !== '-' && rowEmpId === emp.empId.toLowerCase());

    if (isMatch) {
      resignInfo = {
        resignDateText: formatThaiDateDisplay(new Date(resignedData[r][4])),
        dueDateText: formatThaiDateDisplay(new Date(resignedData[r][5])),
        alertStatus: rowStatus || 'Pending'
      };
      break;
    }
  }

  const bubble = buildEmployeeStatusBubble({
    empId: emp.empId,
    name: emp.name,
    email: emp.email,
    dept: emp.dept,
    mailStatus: emp.status,
    resignInfo: resignInfo,
    sheetUrl: ss.getUrl()
  });

  replyFlexMessage(replyToken, `📊 รายงานสถานะของ ${emp.name}`, bubble);
}

/**
 * รายการครบกำหนดในเดือนปัจจุบัน
 */
function handleMonthDueListCommand(replyToken) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resignedSheet = ss.getSheetByName(CONFIG.SHEET_RESIGNED);

  if (!resignedSheet) {
    replyTextMessage(replyToken, '❌ ไม่พบชีตรายการคิวในระบบ');
    return;
  }

  const lastRow = resignedSheet.getLastRow();
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const thaiMonthsFull = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const currentMonthName = `${thaiMonthsFull[currentMonth]} ${currentYear}`;

  const dueList = [];

  if (lastRow >= 2) {
    const data = resignedSheet.getRange(2, 1, lastRow - 1, 9).getValues();
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const dueDateRaw = row[5];
      const status = String(row[6] || '').trim();

      if (!dueDateRaw || status.toLowerCase() === 'cancelled') continue;

      const dDate = new Date(dueDateRaw);
      if (dDate.getMonth() === currentMonth && dDate.getFullYear() === currentYear) {
        dueList.push({
          name: row[1] || '-',
          email: row[2] || '-',
          dueDateText: formatThaiDateDisplay(dDate),
          status: status || 'Pending'
        });
      }
    }
  }

  if (dueList.length === 0) {
    replyTextMessage(replyToken, `📅 รายงานประจำเดือน ${currentMonthName}:\n\n🎉 ในเดือนนี้ไม่มีเมลพนักงานที่ครบกำหนดจัดการค่ะ!`);
    return;
  }

  const bubble = buildMonthDueListBubble({
    monthName: currentMonthName,
    dueList: dueList,
    sheetUrl: ss.getUrl()
  });

  replyFlexMessage(replyToken, `📅 รายการเมลครบกำหนดในเดือน ${currentMonthName} (${dueList.length} ท่าน)`, bubble);
}

/**
 * เมนูช่วยเหลือ
 */
function handleHelpCommand(replyToken) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bubble = buildHelpFlexBubble(ss.getUrl());
  replyFlexMessage(replyToken, '📖 เมนูคำสั่งระบบจัดการเมลพนักงาน', bubble);
}

// ==============================================================================
// 4. SEARCH ENGINE
// ==============================================================================

function cleanSearchTerm(term) {
  if (!term) return '';
  return String(term)
    .replace(/^(?:คุณ|นาย|นางสาว|นาง|น\.ส\.|mr\.|mrs\.|ms\.)\s*/i, '')
    .replace(/^(?:ของ|เมลของ|เมล)\s*/i, '')
    .replace(/^[:\s]+/, '')
    .trim()
    .toLowerCase();
}

function findEmployee(masterSheet, resignedSheet, rawQuery) {
  const cleanQ = cleanSearchTerm(rawQuery);
  if (!cleanQ) return null;

  // 1. ค้นหาในชีตหลัก (Master)
  if (masterSheet && masterSheet.getLastRow() >= 2) {
    const masterData = masterSheet.getDataRange().getValues();
    for (let i = 1; i < masterData.length; i++) {
      const rowEmpId = String(masterData[i][0] || '').trim().toLowerCase();
      const rowName = String(masterData[i][1] || '').trim().toLowerCase();
      const rowEmail = String(masterData[i][2] || '').trim().toLowerCase();
      const rowEmailUser = rowEmail.split('@')[0];

      const matchExact = rowEmpId === cleanQ || rowName === cleanQ || rowEmail === cleanQ || rowEmailUser === cleanQ;
      const matchName = rowName.includes(cleanQ) || (cleanQ.length >= 3 && cleanQ.includes(rowName));
      const matchEmail = cleanQ.length >= 3 && (rowEmail.includes(cleanQ) || rowEmailUser.includes(cleanQ));

      if (matchExact || matchName || matchEmail) {
        return {
          masterRowIndex: i + 1,
          emp: {
            empId: String(masterData[i][0] || '-').trim(),
            name: String(masterData[i][1] || rawQuery).trim(),
            email: String(masterData[i][2] || '-').trim(),
            dept: String(masterData[i][3] || 'ทั่วไป').trim(),
            status: String(masterData[i][4] || 'Active').trim()
          }
        };
      }
    }
  }

  // 2. ค้นหาในชีตคิว (Fallback กรณีไม่มีใน Master)
  if (resignedSheet && resignedSheet.getLastRow() >= 2) {
    const resignedData = resignedSheet.getDataRange().getValues();
    for (let r = resignedData.length - 1; r >= 1; r--) {
      const rowEmpId = String(resignedData[r][0] || '').trim().toLowerCase();
      const rowName = String(resignedData[r][1] || '').trim().toLowerCase();
      const rowEmail = String(resignedData[r][2] || '').trim().toLowerCase();
      const rowEmailUser = rowEmail.split('@')[0];

      const matchExact = rowEmpId === cleanQ || rowName === cleanQ || rowEmail === cleanQ || rowEmailUser === cleanQ;
      const matchName = rowName.includes(cleanQ) || (cleanQ.length >= 3 && cleanQ.includes(rowName));
      const matchEmail = cleanQ.length >= 3 && (rowEmail.includes(cleanQ) || rowEmailUser.includes(cleanQ));

      if (matchExact || matchName || matchEmail) {
        return {
          masterRowIndex: null,
          emp: {
            empId: String(resignedData[r][0] || '-').trim(),
            name: String(resignedData[r][1] || rawQuery).trim(),
            email: String(resignedData[r][2] || '-').trim(),
            dept: String(resignedData[r][3] || 'ทั่วไป').trim(),
            status: 'Inactive'
          }
        };
      }
    }
  }

  return null;
}

// ==============================================================================
// 5. DAILY TIME-DRIVEN TRIGGER
// ==============================================================================
/**
 * ตรวจสอบคิวเมลพนักงานที่ถึงกำหนดเตือน (3 ระยะ: ล่วงหน้า 7 วัน, ล่วงหน้า 3 วัน, ถึงวันครบกำหนด)
 */
function checkResignedEmailsAndNotify() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_RESIGNED);
  if (!sheet || sheet.getLastRow() < 2) return;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();
  const today = new Date();
  const todayStr = Utilities.formatDate(today, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const [tYear, tMonth, tDay] = todayStr.split('-').map(Number);
  const todayDateOnly = new Date(tYear, tMonth - 1, tDay);

  const due7DaysList = [];
  const rows7DaysToUpdate = [];

  const due3DaysList = [];
  const rows3DaysToUpdate = [];

  const dueTodayList = [];
  const rowsDueToUpdate = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIndex = i + 2;
    const dueDateRaw = row[5];
    const status = String(row[6] || '').trim();
    const statusLower = status.toLowerCase();

    // ข้ามรายการที่ปิดงานแล้ว, ยกเลิกการลาออก หรือไม่มีวันที่
    if (statusLower === 'closed' || statusLower === 'cancelled' || !dueDateRaw) {
      continue;
    }

    const dueDateObj = new Date(dueDateRaw);
    if (isNaN(dueDateObj.getTime())) continue;

    const dueDateStr = Utilities.formatDate(dueDateObj, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    const [dYear, dMonth, dDay] = dueDateStr.split('-').map(Number);
    const dueDateOnly = new Date(dYear, dMonth - 1, dDay);

    const diffMs = dueDateOnly.getTime() - todayDateOnly.getTime();
    const daysRemaining = Math.round(diffMs / (1000 * 60 * 60 * 24));

    const empObj = {
      empId: row[0] || '-',
      name: row[1] || '-',
      email: row[2] || '-',
      dept: row[3] || '-',
      resignDateText: formatThaiDateDisplay(new Date(row[4])),
      dueDateText: formatThaiDateDisplay(dueDateObj),
      daysRemaining: daysRemaining,
      sheetUrl: ss.getUrl()
    };

    // 1. ครบกำหนด 3 เดือน (ถึงกำหนดวันนี้ หรือ เลยกำหนด)
    if (daysRemaining <= 0) {
      if (status !== 'ครบกำหนดแล้ว' && statusLower !== 'notified') {
        empObj.stage = 'DUE';
        dueTodayList.push(empObj);
        rowsDueToUpdate.push(rowIndex);
      }
    }
    // 2. แจ้งเตือนล่วงหน้า 3 วัน (เหลือ 1 ถึง 3 วัน)
    else if (daysRemaining <= 3) {
      if (status !== 'เตือน 3 วันแล้ว' && status !== 'ครบกำหนดแล้ว' && statusLower !== 'notified') {
        empObj.stage = '3D';
        due3DaysList.push(empObj);
        rows3DaysToUpdate.push(rowIndex);
      }
    }
    // 3. แจ้งเตือนล่วงหน้า 7 วัน (เหลือ 4 ถึง 7 วัน)
    else if (daysRemaining <= 7) {
      if (status === 'Pending' || status === '') {
        empObj.stage = '7D';
        due7DaysList.push(empObj);
        rows7DaysToUpdate.push(rowIndex);
      }
    }
  }

  const timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

  // ส่งแจ้งเตือนกลุ่มครบกำหนด (วันนี้ / เลยกำหนด)
  if (dueTodayList.length > 0) {
    const success = sendPushFlexNotificationGroup(
      dueTodayList,
      `🚨 แจ้งเตือน: เมลพนักงานครบกำหนด 3 เดือน (${dueTodayList.length} ท่าน)`
    );
    if (success) {
      rowsDueToUpdate.forEach(rIdx => {
        sheet.getRange(rIdx, 7).setValue('ครบกำหนดแล้ว');
        sheet.getRange(rIdx, 8).setValue(`${timestamp} (ครบกำหนด)`);
      });
    }
  }

  // ส่งแจ้งเตือนกลุ่มล่วงหน้า 3 วัน
  if (due3DaysList.length > 0) {
    const success = sendPushFlexNotificationGroup(
      due3DaysList,
      `⚠️ แจ้งเตือนล่วงหน้า 3 วัน: เมลพนักงานใกล้ครบกำหนด (${due3DaysList.length} ท่าน)`
    );
    if (success) {
      rows3DaysToUpdate.forEach(rIdx => {
        sheet.getRange(rIdx, 7).setValue('เตือน 3 วันแล้ว');
        sheet.getRange(rIdx, 8).setValue(`${timestamp} (เตือน 3 วัน)`);
      });
    }
  }

  // ส่งแจ้งเตือนกลุ่มล่วงหน้า 7 วัน
  if (due7DaysList.length > 0) {
    const success = sendPushFlexNotificationGroup(
      due7DaysList,
      `🔔 แจ้งเตือนล่วงหน้า 7 วัน: เมลพนักงานใกล้ครบกำหนด (${due7DaysList.length} ท่าน)`
    );
    if (success) {
      rows7DaysToUpdate.forEach(rIdx => {
        sheet.getRange(rIdx, 7).setValue('เตือน 7 วันแล้ว');
        sheet.getRange(rIdx, 8).setValue(`${timestamp} (เตือน 7 วัน)`);
      });
    }
  }
}

// ==============================================================================
// 6. PARSER & DATE HELPERS
// ==============================================================================
function parseResignCommand(text) {
  if (!text) return null;
  const trimmed = text.trim();

  // แบบ: "แจ้งลาออก สมชาย 08/12/2026"
  const prefixMatch = trimmed.match(/^(?:แจ้งลาออก|ขอแจ้งลาออก)\s+(.+?)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[^\d\s\/\-]+\s+\d{2,4})$/i);
  if (prefixMatch) {
    const parsedDate = parseThaiDate(prefixMatch[2].trim());
    if (parsedDate) return { rawName: prefixMatch[1].trim(), resignDate: parsedDate };
  }

  // แบบ: "สมชาย มีกำหนด ลาออก 08/12/2026"
  const cleanText = trimmed.replace(/^(?:แจ้งลาออก|ขอแจ้งลาออก|แจ้ง)\s*:?\s*/i, '');
  const regex = /^(.+?)\s*(?:มี\s*กำหนด\s*(?:การ\s*)?(?:ลา\s*)?ออก|กำหนด\s*(?:การ\s*)?(?:ลา\s*)?ออก|ลา\s*ออก(?:\s*วัน\s*ที่)?)\s+(.+)$/i;
  const match = cleanText.match(regex);
  if (match) {
    const parsedDate = parseThaiDate(match[2].trim());
    if (parsedDate) return { rawName: match[1].trim(), resignDate: parsedDate };
  }

  return null;
}

function parseThaiDate(str) {
  if (!str) return null;
  const thaiMonths = {
    'มค': 0, 'ม.ค.': 0, 'มกราคม': 0,
    'กพ': 1, 'ก.พ.': 1, 'กุมภาพันธ์': 1,
    'มีค': 2, 'มี.ค.': 2, 'มีนาคม': 2,
    'เมย': 3, 'เม.ย.': 3, 'เมษายน': 3,
    'พค': 4, 'พ.ค.': 4, 'พฤษภาคม': 4,
    'มิย': 5, 'มิ.ย.': 5, 'มิถุนายน': 5,
    'กค': 6, 'ก.ค.': 6, 'กรกฎาคม': 6,
    'สค': 7, 'ส.ค.': 7, 'สิงหาคม': 7,
    'กย': 8, 'ก.ย.': 8, 'กันยายน': 8,
    'ตค': 9, 'ต.ค.': 9, 'ตุลาคม': 9,
    'พย': 10, 'พ.ย.': 10, 'พฤศจิกายน': 10,
    'ธค': 11, 'ธ.ค.': 11, 'ธันวาคม': 11
  };

  const thaiMatch = str.match(/(\d{1,2})\s*([^\d\s\/\-]+)\s*(\d{2,4})/);
  if (thaiMatch) {
    const day = parseInt(thaiMatch[1], 10);
    const monthKey = thaiMatch[2].replace(/\./g, '');
    let year = parseInt(thaiMatch[3], 10);
    let monthIdx = -1;
    for (const [key, val] of Object.entries(thaiMonths)) {
      if (key.replace(/\./g, '') === monthKey) { monthIdx = val; break; }
    }
    if (monthIdx !== -1) {
      if (year < 100) year += 2000;
      if (year > 2400) year -= 543;
      return new Date(year, monthIdx, day);
    }
  }

  const slashMatch = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10) - 1;
    let year = parseInt(slashMatch[3], 10);
    if (year < 100) year += 2000;
    if (year > 2400) year -= 543;
    return new Date(year, month, day);
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function formatThaiDateDisplay(d) {
  if (!d || isNaN(d.getTime())) return '-';
  const thaiMonthsShort = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d.getDate()} ${thaiMonthsShort[d.getMonth()]} ${d.getFullYear()}`;
}

// ==============================================================================
// 7. LINE FLEX MESSAGE BUILDERS
// ==============================================================================
function buildConfirmationFlexBubble(data) {
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#27AE60',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: '✅ อัปเดตสถานะสำเร็จ', weight: 'bold', color: '#FFFFFF', size: 'md' },
        { type: 'text', text: 'บันทึกเข้าคิวรอครบกำหนด 3 เดือนเรียบร้อย', size: 'xs', color: '#D4EFDF', margin: 'xs' }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '16px',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: data.name || '-', weight: 'bold', size: 'lg', color: '#2C3E50' },
            { type: 'text', text: `แผนก: ${data.dept || '-'}`, size: 'xs', color: '#7F8C8D', margin: 'xs' }
          ]
        },
        { type: 'separator', margin: 'sm' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: 'อีเมล', size: 'xs', color: '#95A5A6', flex: 4 },
                { type: 'text', text: data.email || '-', size: 'xs', color: '#2C3E50', weight: 'bold', flex: 6 }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: 'สถานะเมลใหม่', size: 'xs', color: '#95A5A6', flex: 4 },
                { type: 'text', text: 'Inactive (ปิด)', size: 'xs', color: '#E74C3C', weight: 'bold', flex: 6 }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: 'กำหนดออก', size: 'xs', color: '#95A5A6', flex: 4 },
                { type: 'text', text: data.resignDateText || '-', size: 'xs', color: '#2C3E50', flex: 6 }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: 'ครบกำหนดจัดการ', size: 'xs', color: '#27AE60', weight: 'bold', flex: 4 },
                { type: 'text', text: data.dueDateText || '-', size: 'xs', color: '#27AE60', weight: 'bold', flex: 6 }
              ]
            }
          ]
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [
        {
          type: 'button',
          style: 'secondary',
          height: 'sm',
          action: { type: 'uri', label: 'เปิดดูใน Google Sheet', uri: data.sheetUrl || 'https://docs.google.com' }
        }
      ]
    }
  };
}

function buildCancelConfirmationBubble(data) {
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#16A085',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: '↩️ ยกเลิกการลาออกสำเร็จ', weight: 'bold', color: '#FFFFFF', size: 'md' },
        { type: 'text', text: 'คืนสถานะเมลเป็น Active เรียบร้อยแล้วค่ะ', size: 'xs', color: '#E8F8F5', margin: 'xs' }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '16px',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: data.name || '-', weight: 'bold', size: 'lg', color: '#2C3E50' },
            { type: 'text', text: `รหัส: ${data.empId || '-'} | แผนก: ${data.dept || '-'}`, size: 'xs', color: '#7F8C8D', margin: 'xs' }
          ]
        },
        { type: 'separator', margin: 'sm' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: 'อีเมล', size: 'xs', color: '#95A5A6', flex: 4 },
                { type: 'text', text: data.email || '-', size: 'xs', color: '#2C3E50', weight: 'bold', flex: 6 }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: 'สถานะเมลปัจจุบัน', size: 'xs', color: '#95A5A6', flex: 4 },
                { type: 'text', text: 'Active (เปิดใช้งานปกติ)', size: 'xs', color: '#27AE60', weight: 'bold', flex: 6 }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: 'คิวจัดการเมล', size: 'xs', color: '#95A5A6', flex: 4 },
                { type: 'text', text: 'ยกเลิกคิวเรียบร้อย', size: 'xs', color: '#E67E22', weight: 'bold', flex: 6 }
              ]
            }
          ]
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [
        {
          type: 'button',
          style: 'secondary',
          height: 'sm',
          action: { type: 'uri', label: 'เปิดดูใน Google Sheet', uri: data.sheetUrl || 'https://docs.google.com' }
        }
      ]
    }
  };
}

function buildEmployeeStatusBubble(data) {
  const isMailActive = String(data.mailStatus).toLowerCase() === 'active';
  const resignInfo = data.resignInfo;

  const detailContents = [
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: 'อีเมล', size: 'xs', color: '#95A5A6', flex: 4 },
        { type: 'text', text: data.email || '-', size: 'xs', color: '#2C3E50', weight: 'bold', flex: 6 }
      ]
    },
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: 'สถานะเมล', size: 'xs', color: '#95A5A6', flex: 4 },
        {
          type: 'text',
          text: isMailActive ? '🟢 Active (ใช้งานอยู่)' : '🔴 Inactive (ปิดอยู่)',
          size: 'xs',
          color: isMailActive ? '#27AE60' : '#E74C3C',
          weight: 'bold',
          flex: 6
        }
      ]
    }
  ];

  if (resignInfo) {
    detailContents.push(
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: 'กำหนดลาออก', size: 'xs', color: '#95A5A6', flex: 4 },
          { type: 'text', text: resignInfo.resignDateText || '-', size: 'xs', color: '#2C3E50', flex: 6 }
        ]
      },
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: 'ครบกำหนดจัดการ', size: 'xs', color: '#95A5A6', flex: 4 },
          { type: 'text', text: resignInfo.dueDateText || '-', size: 'xs', color: '#E74C3C', weight: 'bold', flex: 6 }
        ]
      },
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: 'สถานะการเตือน', size: 'xs', color: '#95A5A6', flex: 4 },
          { type: 'text', text: resignInfo.alertStatus || 'Pending', size: 'xs', color: '#2980B9', weight: 'bold', flex: 6 }
        ]
      }
    );
  } else {
    detailContents.push({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: 'ข้อมูลลาออก', size: 'xs', color: '#95A5A6', flex: 4 },
        { type: 'text', text: 'ไม่มีประวัติการแจ้งลาออก', size: 'xs', color: '#7F8C8D', flex: 6 }
      ]
    });
  }

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#2980B9',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: '👤 ข้อมูลสถานะพนักงาน', weight: 'bold', color: '#FFFFFF', size: 'md' },
        { type: 'text', text: 'ตรวจสอบสถานะเมลและการแจ้งเตือนล่าสุด', size: 'xs', color: '#D4E6F1', margin: 'xs' }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '16px',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: data.name || '-', weight: 'bold', size: 'lg', color: '#2C3E50' },
            { type: 'text', text: `รหัส: ${data.empId || '-'} | แผนก: ${data.dept || '-'}`, size: 'xs', color: '#7F8C8D', margin: 'xs' }
          ]
        },
        { type: 'separator', margin: 'sm' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: detailContents
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [
        {
          type: 'button',
          style: 'secondary',
          height: 'sm',
          action: { type: 'uri', label: 'เปิดดูใน Google Sheet', uri: data.sheetUrl || 'https://docs.google.com' }
        }
      ]
    }
  };
}

function buildMonthDueListBubble(data) {
  const listItems = data.dueList.slice(0, 10).map((item, idx) => {
    let statusColor = '#7F8C8D';
    if (item.status === 'ครบกำหนดแล้ว' || item.status === 'Notified') statusColor = '#C0392B';
    else if (item.status === 'เตือน 3 วันแล้ว') statusColor = '#E67E22';
    else if (item.status === 'เตือน 7 วันแล้ว') statusColor = '#2980B9';
    else if (item.status === 'Closed') statusColor = '#27AE60';
    else if (item.status === 'Pending') statusColor = '#F39C12';

    return {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      margin: 'md',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: `${idx + 1}. ${item.name}`, weight: 'bold', size: 'sm', color: '#2C3E50', flex: 7 },
            { type: 'text', text: item.status, size: 'xs', color: statusColor, weight: 'bold', align: 'end', flex: 3 }
          ]
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: item.email, size: 'xxs', color: '#7F8C8D', flex: 6 },
            { type: 'text', text: `ครบ: ${item.dueDateText}`, size: 'xxs', color: '#E74C3C', weight: 'bold', align: 'end', flex: 4 }
          ]
        }
      ]
    };
  });

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#D35400',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: `📅 ครบกำหนดในเดือน ${data.monthName}`, weight: 'bold', color: '#FFFFFF', size: 'md' },
        { type: 'text', text: `พบ ${data.dueList.length} รายการที่ต้องจัดการในเดือนนี้`, size: 'xs', color: '#FADBD8', margin: 'xs' }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: 'รายชื่อเมลพนักงานที่ถึงกำหนดจัดการ:', size: 'xs', color: '#95A5A6', weight: 'bold' },
        ...listItems
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#D35400',
          height: 'sm',
          action: { type: 'uri', label: 'เปิดดูใน Google Sheet', uri: data.sheetUrl || 'https://docs.google.com' }
        }
      ]
    }
  };
}

function buildHelpFlexBubble(sheetUrl) {
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1B4F72',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: '🤖 เมนูคำสั่งระบบจัดการเมลพนักงาน', weight: 'bold', color: '#FFFFFF', size: 'md' },
        { type: 'text', text: 'ไอทีสามารถพิมพ์สั่งงานในกลุ่มได้ตามนี้ค่ะ', size: 'xs', color: '#D4E6F1', margin: 'xs' }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '16px',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            { type: 'text', text: '1. 📝 แจ้งพนักงานลาออก (ปรับ Inactive + ตั้งคิว 3 เดือน)', size: 'xs', weight: 'bold', color: '#1B4F72' },
            { type: 'text', text: '👉 สมชาย มีกำหนด ลาออก 08/12/2026', size: 'xs', color: '#2C3E50' }
          ]
        },
        { type: 'separator' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            { type: 'text', text: '2. ↩️ ยกเลิกการลาออก (คืนสถานะเป็น Active)', size: 'xs', weight: 'bold', color: '#16A085' },
            { type: 'text', text: '👉 ยกเลิก สมชาย หรือ ยกเลิกลาออก สมชาย', size: 'xs', color: '#2C3E50' }
          ]
        },
        { type: 'separator' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            { type: 'text', text: '3. 🔍 เช็คสถานะเมลของพนักงาน', size: 'xs', weight: 'bold', color: '#2980B9' },
            { type: 'text', text: '👉 เช็คสถานะ สมชาย หรือ สถานะ สมชาย', size: 'xs', color: '#2C3E50' }
          ]
        },
        { type: 'separator' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            { type: 'text', text: '4. 📅 เช็ครายการที่ครบกำหนดจัดการในเดือนนี้', size: 'xs', weight: 'bold', color: '#D35400' },
            { type: 'text', text: '👉 กำหนดในเดือนนี้มีใครบ้าง', size: 'xs', color: '#2C3E50' }
          ]
        },
        { type: 'separator' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            { type: 'text', text: '5. 🆔 ตรวจสอบรหัสห้อง / กลุ่ม', size: 'xs', weight: 'bold', color: '#7F8C8D' },
            { type: 'text', text: '👉 getid', size: 'xs', color: '#2C3E50' }
          ]
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#1B4F72',
          height: 'sm',
          action: { type: 'uri', label: 'เปิดดู Google Sheet ทั้งหมด', uri: sheetUrl || 'https://docs.google.com' }
        }
      ]
    }
  };
}

/**
 * สร้าง Flex Message Bubble สำหรับการแจ้งเตือนตามระยะ (7 วัน, 3 วัน, ครบกำหนด)
 */
function buildStageAlertBubble(emp) {
  let headerColor = '#C0392B';
  let headerTitle = '🚨 ครบกำหนด 3 เดือนแล้ว';
  let headerSubtitle = 'โปรดดำเนินการลบ Mailbox & คืนสิทธิ์ License ทันที';
  let subtitleColor = '#FADBD8';
  let stageLabel = 'สถานะ';
  let stageValue = '🔥 ถึงกำหนดจัดการวันนี้';
  let stageColor = '#C0392B';
  let btnLabel = 'เปิด Google Sheet จัดการเมล';

  if (emp.stage === '7D') {
    headerColor = '#2980B9';
    headerTitle = '🔔 แจ้งเตือนล่วงหน้า 7 วัน';
    headerSubtitle = 'เมลพนักงานใกล้ครบกำหนด 3 เดือน';
    subtitleColor = '#D4E6F1';
    stageLabel = 'ระยะเวลาที่เหลือ';
    stageValue = `⏳ อีก ${emp.daysRemaining} วัน (เตรียมสำรองข้อมูล)`;
    stageColor = '#2980B9';
    btnLabel = 'เปิดดูใน Google Sheet';
  } else if (emp.stage === '3D') {
    headerColor = '#E67E22';
    headerTitle = '⚠️ แจ้งเตือนล่วงหน้า 3 วัน';
    headerSubtitle = 'ใกล้ถึงกำหนดลบ Mailbox & คืนสิทธิ์ License';
    subtitleColor = '#FDEBD0';
    stageLabel = 'ระยะเวลาที่เหลือ';
    stageValue = `⏳ อีก ${emp.daysRemaining} วัน (เตรียมการลบเมล)`;
    stageColor = '#E67E22';
    btnLabel = 'เปิดดูใน Google Sheet';
  } else if (emp.daysRemaining < 0) {
    headerTitle = `🚨 เลยกำหนด 3 เดือนแล้ว (${Math.abs(emp.daysRemaining)} วัน)`;
    stageValue = `🔥 เลยกำหนดมาแล้ว ${Math.abs(emp.daysRemaining)} วัน`;
  }

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: headerColor,
      paddingAll: '16px',
      contents: [
        { type: 'text', text: headerTitle, weight: 'bold', color: '#FFFFFF', size: 'md' },
        { type: 'text', text: headerSubtitle, size: 'xs', color: subtitleColor, margin: 'xs' }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '16px',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: emp.name || '-', weight: 'bold', size: 'lg', color: '#1A252C' },
            { type: 'text', text: `รหัส: ${emp.empId || '-'} | แผนก: ${emp.dept || '-'}`, size: 'xs', color: '#7F8C8D', margin: 'xs' }
          ]
        },
        { type: 'separator', margin: 'sm' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: 'อีเมลเป้าหมาย', size: 'xs', color: '#95A5A6', flex: 4 },
                { type: 'text', text: emp.email || '-', size: 'xs', color: '#2C3E50', weight: 'bold', flex: 6 }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: 'วันที่ออก', size: 'xs', color: '#95A5A6', flex: 4 },
                { type: 'text', text: emp.resignDateText || '-', size: 'xs', color: '#2C3E50', flex: 6 }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: 'ครบกำหนด 3 เดือน', size: 'xs', color: '#95A5A6', flex: 4 },
                { type: 'text', text: emp.dueDateText || '-', size: 'xs', color: '#2C3E50', weight: 'bold', flex: 6 }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: stageLabel, size: 'xs', color: stageColor, weight: 'bold', flex: 4 },
                { type: 'text', text: stageValue, size: 'xs', color: stageColor, weight: 'bold', flex: 6 }
              ]
            }
          ]
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: headerColor,
          height: 'sm',
          action: { type: 'uri', label: btnLabel, uri: emp.sheetUrl || 'https://docs.google.com' }
        }
      ]
    }
  };
}

function buildDueAlertBubble(emp) {
  return buildStageAlertBubble({ ...emp, stage: emp.stage || 'DUE' });
}

// ==============================================================================
// 8. LINE API MESSAGING CALLS
// ==============================================================================
function replyFlexMessage(replyToken, altText, flexBubble) {
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}`
      },
      payload: JSON.stringify({
        replyToken: replyToken,
        messages: [{ type: 'flex', altText: altText, contents: flexBubble }]
      }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      Logger.log('[LINE Flex Reply Error] ' + res.getContentText());
      replyTextMessage(replyToken, altText);
    }
  } catch (err) {
    Logger.log('[replyFlexMessage Exception] ' + err.toString());
  }
}

function replyTextMessage(replyToken, text) {
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}`
      },
      payload: JSON.stringify({
        replyToken: replyToken,
        messages: [{ type: 'text', text: text }]
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    Logger.log('[replyTextMessage Exception] ' + err.toString());
  }
}

/**
 * ส่ง LINE Push Flex Message แบบจัดกลุ่มตามระยะการแจ้งเตือน
 */
function sendPushFlexNotificationGroup(employees, altText) {
  if (!CONFIG.LINE_CHANNEL_ACCESS_TOKEN || !CONFIG.LINE_TARGET_ID) {
    Logger.log('[sendPushFlexNotificationGroup] Missing Token or Target ID');
    return false;
  }
  const chunkSize = 10;
  for (let i = 0; i < employees.length; i += chunkSize) {
    const chunk = employees.slice(i, i + chunkSize);
    const bubbles = chunk.map(emp => buildStageAlertBubble(emp));
    const payload = {
      to: CONFIG.LINE_TARGET_ID,
      messages: [{
        type: 'flex',
        altText: altText || '🚨 แจ้งเตือนเมลพนักงานครบกำหนด',
        contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles }
      }]
    };

    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}`
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) {
      Logger.log('[LINE Push Error] ' + res.getContentText());
      return false;
    }
  }
  return true;
}

function sendPushFlexNotification(employees) {
  return sendPushFlexNotificationGroup(employees, `🚨 แจ้งเตือน: เมลพนักงานครบกำหนด 3 เดือน (${employees.length} ท่าน)`);
}

// ==============================================================================
// 9. SYSTEM INITIALIZATION & SETUP
// ==============================================================================
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. ชีตหลัก: รายชื่อเมลพนักงาน
  let masterSheet = ss.getSheetByName(CONFIG.SHEET_MASTER);
  if (!masterSheet) masterSheet = ss.insertSheet(CONFIG.SHEET_MASTER);

  const masterHeaders = ['ลำดับ', 'ชื่อ-นามสกุล (FullName)', 'อีเมล (Email)', 'แผนก (Department)', 'สถานะเมล (Status)', 'อัปเดตล่าสุด (UpdatedAt)'];
  if (masterSheet.getLastRow() === 0) {
    masterSheet.getRange(1, 1, 1, masterHeaders.length).setValues([masterHeaders]);
    masterSheet.getRange(1, 1, 1, masterHeaders.length).setBackground('#1B4F72').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
    masterSheet.setFrozenRows(1);
    const mailStatusRule = SpreadsheetApp.newDataValidation().requireValueInList(['Active', 'Inactive'], true).build();
    masterSheet.getRange('E2:E1000').setDataValidation(mailStatusRule);
    masterSheet.autoResizeColumns(1, masterHeaders.length);
  }

  // 2. ชีตคิว: รายการเมลที่กำหนดออก
  let resignedSheet = ss.getSheetByName(CONFIG.SHEET_RESIGNED);
  if (!resignedSheet) resignedSheet = ss.insertSheet(CONFIG.SHEET_RESIGNED);

  const resignedHeaders = ['รหัสพนักงาน (EmpID)', 'ชื่อ-นามสกุล (FullName)', 'อีเมล (Email)', 'แผนก (Department)', 'กำหนดออก (ResignDate)', 'ครบกำหนดจัดการเมล (DueDate)', 'สถานะแจ้งเตือน (Status)', 'เวลาที่แจ้งเตือน (NotifiedAt)', 'หมายเหตุ (Remark)'];
  if (resignedSheet.getLastRow() === 0) {
    resignedSheet.getRange(1, 1, 1, resignedHeaders.length).setValues([resignedHeaders]);
    resignedSheet.getRange(1, 1, 1, resignedHeaders.length).setBackground('#78281F').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
    resignedSheet.setFrozenRows(1);
  }

  // อัปเดต Dropdown สถานะแจ้งเตือนให้รองรับ 3 ระยะ: Pending, เตือน 7 วันแล้ว, เตือน 3 วันแล้ว, ครบกำหนดแล้ว, Closed, Cancelled
  const statusRule = SpreadsheetApp.newDataValidation().requireValueInList([
    'Pending',
    'เตือน 7 วันแล้ว',
    'เตือน 3 วันแล้ว',
    'ครบกำหนดแล้ว',
    'Closed',
    'Cancelled'
  ], true).build();
  resignedSheet.getRange('G2:G1000').setDataValidation(statusRule);
  resignedSheet.autoResizeColumns(1, resignedHeaders.length);

  Logger.log('[initSheets] ตรวจสอบและตั้งค่าหัวตารางทั้ง 2 ชีตเรียบร้อย');
}

function setupDailyTrigger() {
  const existing = ScriptApp.getProjectTriggers();
  existing.forEach(t => {
    if (t.getHandlerFunction() === 'checkResignedEmailsAndNotify') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('checkResignedEmailsAndNotify')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  Logger.log('[setupDailyTrigger] ตั้งเวลา Daily Trigger 09:00 น. สำเร็จ');
}

/**
 * ฟังก์ชันสำหรับทดสอบส่งการ์ดแจ้งเตือนทั้ง 3 ระยะเข้ากลุ่ม LINE ทันที (สำหรับทดสอบ)
 */
function testNotificationStages() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dummyEmp = {
    empId: 'EMP-TEST',
    name: 'ทดสอบ แจ้งเตือน 3 ระยะ',
    email: 'test.alert@regent-chaam.com',
    dept: 'IT Support',
    resignDateText: '7 ต.ค. 2026',
    dueDateText: '7 ม.ค. 2027',
    sheetUrl: ss ? ss.getUrl() : 'https://docs.google.com'
  };

  Logger.log('1. กำลังส่งทดสอบแจ้งเตือนล่วงหน้า 7 วัน (การ์ดสีน้ำเงิน)...');
  sendPushFlexNotificationGroup(
    [{ ...dummyEmp, stage: '7D', daysRemaining: 7 }],
    '🔔 [TEST] แจ้งเตือนล่วงหน้า 7 วัน'
  );

  Logger.log('2. กำลังส่งทดสอบแจ้งเตือนล่วงหน้า 3 วัน (การ์ดสีส้ม)...');
  sendPushFlexNotificationGroup(
    [{ ...dummyEmp, stage: '3D', daysRemaining: 3 }],
    '⚠️ [TEST] แจ้งเตือนล่วงหน้า 3 วัน'
  );

  Logger.log('3. กำลังส่งทดสอบแจ้งเตือนครบกำหนดวันนี้ (การ์ดสีแดง)...');
  sendPushFlexNotificationGroup(
    [{ ...dummyEmp, stage: 'DUE', daysRemaining: 0 }],
    '🚨 [TEST] แจ้งเตือนครบกำหนดวันนี้'
  );

  Logger.log('✅ ส่งทดสอบครบทั้ง 3 ระยะเรียบร้อยแล้วค่ะ');
}
