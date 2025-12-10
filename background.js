// background.js - FINAL "SELF-HEALING" VERSION

const API_KEY = "AIzaSyDsWVJ8aeQJDB6Io6mnkwxiAaiazEfi6Qk"; 

const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + API_KEY;

let isAutoFillingActive = false; 

// --- 1. OFFLINE FALLBACK ---
function generateFallbackData(fields) {
    const mockData = {};
    fields.forEach(field => {
        const key = (field.id + " " + field.name + " " + field.label).toLowerCase();
        const fieldId = field.id || field.name;
        if (!fieldId) return;

        if (key.includes('email')) mockData[fieldId] = "alex@example.com";
        else if ((key.includes('SSN'))||(key.includes('social'))) mockData[fieldId] = "123456789";
        else if (key.includes('phone') || key.includes('mobile')) mockData[fieldId] = "1234567890";
        else if (key.includes('zip')) mockData[fieldId] = "90001";
        else if (key.includes('dob') || key.includes('date')) mockData[fieldId] = "01/01/2000";
        else if (key.includes('first')) mockData[fieldId] = "Alex";
        else if (key.includes('last')) mockData[fieldId] = "Coder";
        else if (key.includes('address')) mockData[fieldId] = "123 Ai Street";
        else if (key.includes('city')) mockData[fieldId] = "New York";
        else if (key.includes('state')) mockData[fieldId] = "California";
        else if (field.type === 'checkbox') mockData[fieldId] = field.label || "true";
        else if (field.type === 'radio') mockData[fieldId] = field.label || "Yes";
        else mockData[fieldId] = "Test";
    });
    return mockData;
}

// --- 2. API CALLER ---
async function fetchWithRetry(promptText) {
    const requestBody = { contents: [{ parts: [{ text: promptText }] }] };
    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        return data; 
    } catch (err) {
        throw err; 
    }
}

function injectAndStart(tabId) {
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
    }, () => {
        if (chrome.runtime.lastError) return;
        chrome.tabs.sendMessage(tabId, { action: 'startAutoFill' });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startProcess') {
        isAutoFillingActive = true; 
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) injectAndStart(tabs[0].id);
        });
        return true; 
    }
    
    // --- STANDARD FETCH ---
    if (request.action === "fetchFormData") {
        handleAIRequest(request.fields, sendResponse);
        return true; 
    }

    // --- NEW: ERROR CORRECTION FETCH ---
    if (request.action === "fetchCorrectionData") {
        console.log("⚠️ Processing Validation Errors:", request.errors);
        
        const promptText = `
            The form rejected the previous data.
            Errors found on page: ${JSON.stringify(request.errors)}
            
            Task: Provide CORRECTED values for the fields related to these errors.
            Rules:
            - If error says "Invalid Date", verify format is MM/DD/YYYY.
            - If error says "Required", provide a value.
            - If error says "Invalid Phone", ensure 10 digits.
            - Return JSON { "field_id": "corrected_value" }.
            
            Fields Available: ${JSON.stringify(request.fields)}
        `;

        handleAIRequest(request.fields, sendResponse, promptText);
        return true;
    }
    
    if (request.action === 'flowComplete') {
        isAutoFillingActive = false;
        console.log("Flow complete.");
    }
    
    if (request.action === 'executeGlobalScript') {
        chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            func: (code) => { try { return eval(code); } catch(e) { return false; } },
            args: [request.code],
            world: 'MAIN'
        }, (results) => {
            const success = results?.[0]?.result === true;
            sendResponse({ success: success });
        });
        return true; 
    }
});

// Helper to handle AI calls
async function handleAIRequest(fields, sendResponse, customPrompt = null) {
    try {
        const promptText = customPrompt || `
            Generate JSON.
            Rules:
            - Dates: "MM/DD/YYYY".
            - Mobile: "1234567890".
            - Email: "alex@example.com".
            - Dropdowns: Exact visible label.
            - Checkboxes: Label text.
            - Raw JSON only.
            Fields: ${JSON.stringify(fields)}
        `;

        const apiData = await fetchWithRetry(promptText);
        let aiText = apiData.candidates?.[0]?.content?.parts?.[0]?.text;
        aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
        let parsedData = JSON.parse(aiText);

        if (Array.isArray(parsedData)) {
            const flatData = {};
            parsedData.forEach(item => {
                const key = item.id || item.name;
                const val = item.currentValue || item.value;
                if (key && val) flatData[key] = val;
            });
            parsedData = flatData;
        }

        console.log("♊ AI DATA:", parsedData);
        sendResponse({ status: "success", fillData: parsedData });

    } catch (error) {
        console.warn("Using Fallback due to error:", error);
        sendResponse({ status: "success", fillData: generateFallbackData(fields) });
    }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && isAutoFillingActive && tab.url && !tab.url.startsWith('chrome://')) {
        injectAndStart(tabId);
    }
});