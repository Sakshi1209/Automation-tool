// content.js - FINAL MERGED (HUMAN SIM + UPLOAD + ERROR HANDLING)g

{ 
    let lastFormHash = ''; 
    // Global Memory
    let interactedFields = new Set();
    let uploadedFiles = new Set(); 
    let correctionAttempts = 0; // To prevent infinite error loops

    const NEXT_BUTTON_SELECTORS = [
      'Next', 'Continue', 'Proceed', 'Submit', 'Apply', 'Finish', 'Done',
      'Register', 'Sign Up', 'Go Next', 'Move Forward', 'Next Step', 
      'Save and Continue', 'Confirm', 'Checkout', 'Get Started'          
    ];

    function safeSendMessage(message, callback) {
        if (chrome.runtime?.id) {
            chrome.runtime.sendMessage(message, callback);
        }
    }

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function autoFillAndNavigate() {
      const currentFormContent = document.body.innerText.replace(/\s+/g, ' ').trim();
      
      // Reset memory if page changed significantly (New Step)
      if (currentFormContent !== lastFormHash) {
          interactedFields.clear(); 
          uploadedFiles.clear(); 
          correctionAttempts = 0; // Reset error retries
          lastFormHash = currentFormContent;
      }

      console.log("Starting Universal Auto-Fill...");
      
      const formFields = extractFormFields(); 

      if (formFields.length === 0) {
        console.log("No fillable form fields found. Checking navigation...");
        attemptToClickNext(); 
        return;
      }

      safeSendMessage({
        action: "fetchFormData",
        fields: formFields
      }, async (response) => {
        if (response && response.status === "success" && response.fillData) {
          console.log("Received AI data. Filling Fields...");
          await fillFieldsSequentially(response.fillData);
          console.log("Filling complete. Checking navigation...");
          setTimeout(attemptToClickNext, 2000);
        } else {
          attemptToClickNext(); 
        }
      });
      
      startObserver(); 
    }

    // --- HELPER: EXTRACT VALIDATION ERRORS ---
    function extractValidationErrors() {
        const errors = [];
        // Angular Material Errors
        document.querySelectorAll('mat-error').forEach(e => errors.push(e.innerText));
        // Standard/Bootstrap Errors
        document.querySelectorAll('.error, .invalid, .text-danger, [role="alert"], .validation-message').forEach(e => {
            if (e.offsetParent !== null) errors.push(e.innerText); // Only visible errors
        });
        return [...new Set(errors)]; // Return unique errors
    }

    // --- HELPER: UPLOAD FILE ---
    async function uploadFile(element) {
        try {
            const uid = element.id || element.name;
            if (uploadedFiles.has(uid) || element.value !== "") return;

            console.log("📂 Uploading sample.pdf to:", element);
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            await wait(300);

            const fileUrl = chrome.runtime.getURL("sample.pdf");
            const response = await fetch(fileUrl);
            const blob = await response.blob();
            const file = new File([blob], "sample.pdf", { type: "application/pdf" });
            
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            element.files = dataTransfer.files;
            
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('blur', { bubbles: true }));
            
            uploadedFiles.add(uid);
            await wait(1500); 
        } catch (err) {
            console.error("Failed to upload file:", err);
        }
    }

    // --- HELPER: CLICK CENTER (Coordinate Click) ---
    function clickCenter(element) {
        const rect = element.getBoundingClientRect();
        const x = rect.left + (rect.width / 2);
        const y = rect.top + (rect.height / 2);
        
        element.scrollIntoView({ behavior: "smooth", block: "center" });

        const clickEvent = new MouseEvent('click', { view: window, bubbles: true, cancelable: true, clientX: x, clientY: y });
        const downEvent = new MouseEvent('mousedown', { view: window, bubbles: true, cancelable: true, clientX: x, clientY: y });

        element.dispatchEvent(downEvent);
        element.dispatchEvent(clickEvent);
        element.click();
    }

    // --- HELPER: CLICK LABEL ---
    function clickLabel(element) {
        if (element.id) {
            const label = document.querySelector(`label[for="${element.id}"]`);
            if (label) {
                label.click();
                return;
            }
        }
        if (element.parentElement) {
            element.parentElement.click();
        }
    }

    function setNativeValue(element, value) {
        element.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        const success = document.execCommand('insertText', false, value);
        if (!success) element.value = value;
        
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(() => element.dispatchEvent(new Event('blur', { bubbles: true })), 50);
    }

    function extractFormFields() {
      const selectors = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select, mat-select, div[role="combobox"]';
      const elements = document.querySelectorAll(selectors);
      const fieldsData = [];

      elements.forEach(element => {
        if (element.offsetParent === null || element.disabled) return; 
        const field = {
          id: element.id,
          name: element.name || element.getAttribute('formcontrolname') || '',
          type: element.type || element.tagName.toLowerCase(),
          placeholder: element.placeholder,
          currentValue: element.value,
          label: getFieldLabel(element)
        };
        fieldsData.push(field);
      });
      return fieldsData;
    }

    function getFieldLabel(element) {
      let labelText = '';
      if (element.getAttribute('aria-label')) return element.getAttribute('aria-label');
      if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label) labelText = label.innerText.trim();
      }
      if (!labelText && element.closest('label')) labelText = element.closest('label').innerText.trim();
      if (!labelText && element.parentElement) labelText = element.parentElement.innerText.trim();
      if (!labelText && element.parentElement && element.parentElement.parentElement) {
          labelText = element.parentElement.parentElement.innerText.trim();
      }
      return labelText || element.placeholder || element.name || element.id || 'Unknown Field';
    }

    async function fillFieldsSequentially(fillData, isCorrection = false) {
        const sanitize = (str) => str.toLowerCase().replace(/[\s\-_]/g, '');
        const dataMap = new Map(Object.entries(fillData).map(([key, value]) => [sanitize(key), value]));
        const selectors = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select, mat-select, div[role="combobox"]';
        const elements = Array.from(document.querySelectorAll(selectors));

        for (const element of elements) {
            if (element.disabled || element.offsetParent === null) continue;

            const elementId = element.id ? sanitize(element.id) : null;
            const elementName = element.name ? sanitize(element.name) : null;
            const elementLabel = sanitize(getFieldLabel(element));
            const elementType = element.type || element.tagName.toLowerCase(); 
            const isDropdown = element.getAttribute('role') === 'combobox' || element.tagName === 'MAT-SELECT' || elementLabel.includes('select');

            // Unique ID logic
            const uniqueId = element.id || element.getAttribute('name') || getFieldLabel(element);

            // 1. FILE UPLOAD
            if (elementType === 'file') {
                await uploadFile(element);
                continue;
            }

            // 2. SKIP IF INTERACTED (Unless correcting errors)
            if (!isCorrection && interactedFields.has(uniqueId)) continue;
            
            // 3. SKIP IF FILLED (Unless correcting errors)
            if (!isCorrection) {
                if ((element.type === 'checkbox' || element.type === 'radio') && element.checked) {
                    interactedFields.add(uniqueId);
                    continue;
                }
                if ((element.type === 'text' || element.tagName === 'TEXTAREA') && element.value) {
                    interactedFields.add(uniqueId);
                    continue;
                }
            }

            let valueToFill = null;
            if (elementId && dataMap.has(elementId)) valueToFill = dataMap.get(elementId);
            else if (elementName && dataMap.has(elementName)) valueToFill = dataMap.get(elementName);
            else {
                for (const [key, value] of dataMap.entries()) {
                    if (elementLabel.includes(key) && key.length > 3) { 
                        valueToFill = value;
                        break;
                    }
                }
            }

            if (valueToFill || isDropdown) {
                try {
                    await wait(100);
                    const fillValueString = valueToFill ? String(valueToFill).toLowerCase() : "";

                    // 4. CHECKBOX
                    if (elementType === 'checkbox') {
                        const label = getFieldLabel(element).toLowerCase();
                        const choices = fillValueString.split(',').map(s => s.trim());
                        const shouldCheck = fillValueString === 'true' || fillValueString === 'yes' || choices.some(choice => label.includes(choice));

                        if (shouldCheck && !element.checked) {
                            clickLabel(element);
                            interactedFields.add(uniqueId); 
                            await wait(200);
                        }
                    }
                    // 5. RADIO
                    else if (elementType === 'radio') {
                         const val = element.value.toLowerCase();
                         const label = getFieldLabel(element).toLowerCase();
                         const match = fillValueString && (label.includes(fillValueString) || val.includes(fillValueString));
                         if (match) {
                             clickLabel(element);
                             const groupName = element.name;
                             if (groupName) document.querySelectorAll(`input[name="${groupName}"]`).forEach(el => interactedFields.add(el.id || el.name));
                             interactedFields.add(uniqueId);
                             await wait(100);
                         }
                    }
                    // 6. DROPDOWNS
                    else if (isDropdown) {
                        console.log("Force Opening Dropdown:", element);
                        clickCenter(element); 
                        await wait(600);
                        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
                        await wait(100);
                        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                        interactedFields.add(uniqueId); 
                        await wait(300);
                    }
                    // 7. TEXT
                    else {
                        if (elementLabel.includes('date') && valueToFill && valueToFill.includes('/')) {
                            if (elementType === 'date') {
                                const [m, d, y] = valueToFill.split('/');
                                valueToFill = `${y}-${m}-${d}`;
                            }
                        }
                        if (valueToFill) setNativeValue(element, valueToFill);
                        interactedFields.add(uniqueId);
                        await wait(50);
                    }
                } catch (e) {
                    console.error("Error filling field", element, e);
                }
            }
        }
    }

    function attemptToClickNext() {
      let nextButton = null;
      const elements = document.querySelectorAll('button, a, input[type="submit"], [role="button"]');
      for (const el of elements) {
        const textContent = el.textContent ? el.textContent.trim() : '';
        if (textContent.toLowerCase().includes('month') || textContent.toLowerCase().includes('year')) continue;
        for (const keyword of NEXT_BUTTON_SELECTORS) {
            if (textContent.includes(keyword)) {
                nextButton = el;
                break;
            }
        }
        if (nextButton) break;
      }

      if (nextButton) {
        const buttonText = nextButton.textContent.trim();
        const codeToExecute = `
          (function() {
            const target = Array.from(document.querySelectorAll('button, a, input[type="submit"], [role="button"]')).find(el => 
                (el.textContent.trim() === '${buttonText}' || el.innerText.trim() === '${buttonText}')
            );
            if (target) {
                target.click(); 
                target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                return true;
            }
            return false;
          })();
        `;
        safeSendMessage({ action: 'executeGlobalScript', code: codeToExecute }, (response) => {
            // *** SELF-HEALING LOGIC ***
            setTimeout(async () => {
                 const currentContent = document.body.innerText.replace(/\s+/g, ' ').trim();
                 
                 // If content hasn't changed, we might be stuck
                 if (currentContent === lastFormHash) {
                     const errors = extractValidationErrors();
                     
                     if (errors.length > 0 && correctionAttempts < 2) {
                         console.warn("⚠️ Validation Errors Found:", errors);
                         correctionAttempts++;
                         
                         // Ask AI to fix these specific errors
                         const formFields = extractFormFields();
                         safeSendMessage({
                            action: "fetchCorrectionData", // This must be handled in background.js
                            fields: formFields,
                            errors: errors
                         }, async (resp) => {
                             if (resp && resp.status === "success") {
                                 console.log("🩹 Applying Corrections...");
                                 // Passing true for 'isCorrection' allows overwriting bad data
                                 await fillFieldsSequentially(resp.fillData, true); 
                                 setTimeout(attemptToClickNext, 1000); 
                             }
                         });
                         return; 
                     }
                     console.warn("Content unchanged & No fixable errors. Stopping.");
                     safeSendMessage({ action: 'flowComplete' });
                 } else {
                     // Page changed successfully!
                     if (document.querySelector('form, input, textarea')) autoFillAndNavigate();
                 }
             }, 3000); // Wait 3s for validation messages
        });
      } else {
        safeSendMessage({ action: 'flowComplete' }); 
      }
    }

    function startObserver() {
        const observer = new MutationObserver((mutationsList, observer) => {
            let formChanged = false;
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                     if (document.querySelector('form, input, textarea')) {
                        formChanged = true;
                        break;
                     }
                }
            }
            if (formChanged) {
                observer.disconnect();
                setTimeout(autoFillAndNavigate, 1500); 
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (!window.hasAutoFillListener) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'startAutoFill') {
                startObserver();
                autoFillAndNavigate();
                sendResponse({ success: true });
            }
        });
        window.hasAutoFillListener = true;
    }

}