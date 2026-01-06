const API_KEY = "YOUR_API_KEY"; 

const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + API_KEY;

let isAutoFillingActive = false;

// --- 1. LOCAL DATA GENERATOR ---
function generateLocalData(fields) {
    const data = {};
    fields.forEach(f => {
        const key = f.label || f.id || f.name;
        const lowerKey = key.toLowerCase();

        // 1. DATES
        if (lowerKey.includes('date') || lowerKey.includes('dob') || lowerKey.includes('birth')) {
            data[key] = "01/01/1990";
        }
        // 2. CONTACT
        else if (lowerKey.includes('email')) data[key] = "alex@example.com";
        else if (lowerKey.includes('phone') || lowerKey.includes('mobile')) data[key] = "1234567890";
        else if (lowerKey.includes('ssn') || lowerKey.includes('social')) data[key] = "123456789";
        else if (lowerKey.includes('zip')) data[key] = "73102";
        // 3. ADDRESS (County Fix Here)
        else if (lowerKey.includes('county')) data[key] = "Oklahoma County"; // <--- FIXED
        else if (lowerKey.includes('address') || lowerKey.includes('street')) data[key] = "123 Tech Drive";
        else if (lowerKey.includes('city')) data[key] = "Oklahoma City";
        else if (lowerKey.includes('state')) data[key] = "Oklahoma";
        else if (lowerKey.includes('country')) data[key] = "USA";
        // 4. FINANCIAL
        else if (lowerKey.includes('income') || lowerKey.includes('amount')) data[key] = "1000";
        // 5. NAMES
        else if (lowerKey.includes('first')|| lowerKey.includes('name')) data[key] = "Alex";
        else if (lowerKey.includes('last')) data[key] = "Coder";
        else if (lowerKey.includes('middle')) data[key] = "J";
        // 6. CHECKBOXES
        else if (f.type === 'checkbox' || f.type === 'radio' || f.type === 'mat-checkbox') {
            data[key] = "true";
        } 
        else {
            data[key] = "Test"; 
        }
    });
    return data;
}

function enforceCheckboxes(fillData, originalFields) {
    originalFields.forEach(field => {
        if (field.type === 'checkbox' || field.type === 'mat-checkbox') {
            const key = field.label || field.id;
            fillData[key] = "true";
        }
    });
    return fillData;
}

const USER_PERSONA = `
    First Name: Alex
    Middle Name: J
    Last Name: Coder
    DOB: 01/01/1990
    SSN: 123456789
    Phone: 1234567890
    Email: alex@example.com
    Address: 123 Tech Drive, Oklahoma City, OK 73102
    County: Oklahoma County
    Income: 1000
    Gender: Male
`;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startProcess') {
        isAutoFillingActive = true;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) return;
            injectAndRun(tabs[0].id);
        });
        return true;
    }
    if (request.action === 'flowComplete') isAutoFillingActive = false;

    if (request.action === "fetchFormData") {
        if (!isAutoFillingActive) return;

        const prompt = `
            Act as a form filler using this persona:
            ${USER_PERSONA}
            
            RULES:
            1. Use the EXACT "label" text from the input list as the JSON Key.
            2. Text Fields: Use persona data. If label is "County", use "Oklahoma County".
            3. Checkboxes/Radios: Return "true".
            
            INPUT FIELDS:
            ${JSON.stringify(request.fields)}
        `;

        fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        })
        .then(res => res.json())
        .then(data => {
            if (!data.candidates) throw new Error("AI Blocked");
            let aiText = data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
            let parsed = JSON.parse(aiText);
            
            let finalData = Array.isArray(parsed) ? 
                parsed.reduce((acc, item) => ({ ...acc, [item.label || item.id]: item.value || "true" }), {}) : 
                parsed;

            finalData = enforceCheckboxes(finalData, request.fields);
            sendResponse({ fillData: finalData });
        })
        .catch(err => {
            let localData = generateLocalData(request.fields);
            localData = enforceCheckboxes(localData, request.fields);
            sendResponse({ fillData: localData });
        });
        return true; 
    }
});

function injectAndRun(tabId) {
    chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] }, () => {
        chrome.tabs.sendMessage(tabId, { action: 'startAutoFill' });
    });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && isAutoFillingActive && tab.url && !tab.url.startsWith('chrome://')) {
        injectAndRun(tabId);
    }
});
