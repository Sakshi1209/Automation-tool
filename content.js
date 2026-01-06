if (window.hasRunAutoFill) {
    console.log("🛑 Script already active.");
} else {
    window.hasRunAutoFill = true;

    (function() {
        let lastUrl = window.location.href;
        
        let interactedFields = new Set();
        let modalInteracted = new Set(); 
        let lockedGroups = new Set(); 
        let observer = null;

        const NEXT_BUTTON_SELECTORS = ['Next', 'Continue', 'Proceed', 'Submit', 'Apply', 'Finish', 'Done', 'Confirm', 'Next Step','Get Started'];
        const SIDE_QUEST_BUTTONS = ['Validate Address', 'Verify Address', 'Check Availability', 'Add'];
        const MODAL_SAVE_BUTTONS = ['Save', 'Use this Address', 'Confirm', 'Ok', 'Yes','Done','I Understand', 'Continue'];

        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        function safeSendMessage(message, callback) {
            if (chrome.runtime?.id) chrome.runtime.sendMessage(message, callback);
        }

        async function autoFillAndNavigate() {
            // 1. MODAL CHECK
            const modal = document.querySelector('mat-dialog-container, .modal, .popup');
            if (modal) {
                console.log("🛡️ Modal Detected. Pausing Main Loop.");
                await handleModal(modal);
                return; 
            }

            const currentUrl = window.location.href;
            if (currentUrl !== lastUrl) {
                console.log("🔄 NEW URL DETECTED! Wiping Memory.");
                interactedFields.clear(); 
                modalInteracted.clear(); 
                lockedGroups.clear(); 
                lastUrl = currentUrl;
            }

            console.log("🚀 Starting Fill Sequence...");
            const formFields = extractFormFields(document); 

            if (formFields.length === 0) {
                await handleSpecialButtons(); 
                attemptToClickNext(); 
                return;
            }

            safeSendMessage({ action: "fetchFormData", fields: formFields }, async (response) => {
                if (response && response.fillData) {
                    await fillFieldsSequentially(response.fillData, document);
                    await handleSpecialButtons();
                    console.log("✅ Filling Complete.");
                    await wait(1000);
                    attemptToClickNext();
                }
            });
        }

        // --- HANDLERS ---
        async function handleModal(modal) {
            await wait(1000); 
            const boxes = modal.querySelectorAll('mat-checkbox, input[type="checkbox"]');
            
            for (const box of boxes) {
                const boxId = box.id || "unknown_modal_box_" + Math.random();
                if (!modalInteracted.has(boxId)) {
                    if (box.readOnly || box.disabled || box.getAttribute('aria-disabled') === 'true') continue;
                    if (!isChecked(box)) {
                        console.log("   -> Force-checking modal checkbox");
                        await smartClick(box);
                        modalInteracted.add(boxId); 
                    }
                }
            }

            const modalFields = extractFormFields(modal);
            if (modalFields.length > 0) {
                await new Promise(resolve => {
                    safeSendMessage({ action: "fetchFormData", fields: modalFields }, async (resp) => {
                        if (resp && resp.fillData) await fillFieldsSequentially(resp.fillData, modal);
                        resolve();
                    });
                });
            }
            await wait(500);
            const saveBtn = Array.from(modal.querySelectorAll('button')).find(b => 
                MODAL_SAVE_BUTTONS.some(kw => b.innerText.includes(kw))
            );
            if (saveBtn) {
                console.log("   💾 Saving Modal...");
                saveBtn.click();
                await wait(2000); 
            }
        }

        async function handleSpecialButtons() {
            if (document.querySelector('mat-dialog-container, .modal, .popup')) return;

            const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
            const sideQuestBtn = buttons.find(b => {
                const txt = b.innerText.trim();
                const isDisabled = b.disabled || b.classList.contains('disabled') || b.getAttribute('aria-disabled') === 'true';
                return SIDE_QUEST_BUTTONS.some(kw => txt.includes(kw)) && b.offsetParent !== null && !isDisabled;
            });

            if (sideQuestBtn) {
                const btnText = sideQuestBtn.innerText.trim();
                if (lockedGroups.has(btnText)) return;

                console.log("🛡️ Clicking Side Quest Button:", btnText);
                sideQuestBtn.click();
                lockedGroups.add(btnText); 
                
                await wait(2500); 
                const modal = document.querySelector('mat-dialog-container, .modal, .popup');
                if (modal) await handleModal(modal);
            }
        }

        // --- HELPERS ---
        function setNativeValue(element, value, label) {
            let currentVal = element.value || "";
            const cleanVal = currentVal.replace(/[_\-\/\s]/g, '');
            const lowerLabel = label.toLowerCase();
            if (cleanVal.length > 0 && !currentVal.includes("Test") && !currentVal.includes("Unknown") && !currentVal.includes("N/A")) return;

            let finalValue = value;
            if (lowerLabel.includes('date') || lowerLabel.includes('dob') || lowerLabel.includes('birth') || lowerLabel.includes('mm/dd/yyyy')) {
                finalValue = "01/01/1990"; 
            } else if (lowerLabel.includes('ssn') || lowerLabel.includes('social')) {
                finalValue = "123456789"; 
            } else if (lowerLabel.includes('phone')) {
                finalValue = "1234567890";
            }
            if (finalValue === "N/A" && (lowerLabel.includes('date') || lowerLabel.includes('mm/dd/yyyy'))) {
                finalValue = "01/01/1990";
            }

            console.log(`   -> Filling "${finalValue}" into "${label}"`);
            element.focus();
            const proto = Object.getPrototypeOf(element);
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            if (setter) setter.call(element, finalValue);
            else element.value = finalValue;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('blur', { bubbles: true }));
        }

        async function uploadRealFile(inputElement) {
            try {
                const url = chrome.runtime.getURL("sample.pdf");
                const response = await fetch(url);
                const blob = await response.blob();
                
                const file = new File([blob], "sample.pdf", { type: 'application/pdf' });
                
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                inputElement.files = dataTransfer.files;

                console.log(`📂 Uploading "sample.pdf" (Real File) to:`, inputElement);

                inputElement.dispatchEvent(new Event('change', { bubbles: true }));
                inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (error) {
                console.error("❌ Failed to upload sample.pdf. Ensure it is in 'web_accessible_resources' in manifest.json", error);
            }
        }

        function isChecked(element) {
            return element.checked || 
                   element.getAttribute('aria-checked') === 'true' || 
                   element.closest('.mat-checkbox-checked') !== null ||
                   element.closest('.mat-radio-checked') !== null ||
                   element.classList.contains('mat-checkbox-checked') ||
                   element.classList.contains('mat-radio-checked');
        }

        function getGroupId(element) {
            if (element.name) return `NAME:${element.name}`;
            const matGroup = element.closest('mat-radio-group');
            if (matGroup && matGroup.id) return `MAT:${matGroup.id}`;
            if (element.parentElement) return `PARENT:${element.parentElement.className}`;
            return null;
        }

        async function smartClick(element) {
            if (element.disabled || element.readOnly || element.getAttribute('aria-disabled') === 'true') return;

            const type = element.type || element.tagName.toLowerCase();
            const isRadio = type === 'radio' || element.tagName === 'MAT-RADIO-BUTTON';
            const groupId = getGroupId(element);

            if (isRadio && groupId) {
                if (lockedGroups.has(groupId)) return; 
                if (isChecked(element) || element.closest('mat-radio-group')?.querySelector('.mat-radio-checked')) {
                    lockedGroups.add(groupId); 
                    return;
                }
            }

            console.log("⚡ CLICKING:", element); 
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            await wait(100);

            const matInner = element.closest('mat-checkbox')?.querySelector('.mat-checkbox-inner-container') ||
                             element.closest('mat-radio-button')?.querySelector('.mat-radio-container');
                             
            if (matInner) matInner.click();
            else if (element.id && document.querySelector(`label[for="${element.id}"]`)) document.querySelector(`label[for="${element.id}"]`).click();
            else element.click();
            
            await wait(50);
            if (!isChecked(element) && (type === 'checkbox' || element.tagName === 'MAT-CHECKBOX')) {
                element.checked = true;
                element.dispatchEvent(new Event('change', { bubbles: true }));
            }

            if (isRadio && groupId) lockedGroups.add(groupId);
            await wait(150);
        }

        function isReadOnlyField(el) {
            return el.readOnly || 
                   el.disabled || 
                   el.getAttribute('readonly') !== null || 
                   el.getAttribute('aria-readonly') === 'true' || 
                   el.getAttribute('aria-disabled') === 'true' ||
                   el.classList.contains('disabled');
        }

        function extractFormFields(rootElement) {
            const selectors = 'input:not([type="hidden"]), textarea, select, mat-select, mat-checkbox, mat-radio-button';
            const elements = rootElement.querySelectorAll(selectors);
            
            return Array.from(elements).filter(el => {
                return el.offsetParent !== null && !isReadOnlyField(el);
            }).map(el => ({
                id: el.id,
                name: el.name || el.getAttribute('formcontrolname') || '',
                type: el.type || el.tagName.toLowerCase(),
                label: getFieldLabel(el)
            }));
        }

        function getFieldLabel(element) {
            let labelText = '';
            if (element.id && document.querySelector(`label[for="${element.id}"]`)) {
                labelText = document.querySelector(`label[for="${element.id}"]`).innerText;
            }
            if (!labelText && element.closest('label')) labelText = element.closest('label').innerText;
            if (!labelText && element.closest('mat-form-field')) {
                const matLabel = element.closest('mat-form-field').querySelector('mat-label');
                if (matLabel) labelText = matLabel.innerText;
            }
            if (!labelText && element.closest('mat-checkbox')) labelText = element.closest('mat-checkbox').innerText;
            if (!labelText && element.closest('mat-radio-button')) labelText = element.closest('mat-radio-button').innerText;
            return (labelText || element.placeholder || element.name || "Unknown").replace(/\s+/g, ' ').trim();
        }

        async function fillFieldsSequentially(fillData, rootElement) {
            const sanitize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
            const aiKeys = Object.keys(fillData).map(k => sanitize(k));
            const isFallback = fillData["fallback"] === "true";

            const elements = Array.from(rootElement.querySelectorAll('input:not([type="hidden"]), textarea, select, mat-select, mat-checkbox, mat-radio-button'));

            for (const element of elements) {
                // ============================================================
                // 🛑 GLOBAL READ-ONLY GUARD
                // ============================================================
                if (element.offsetParent === null || isReadOnlyField(element)) {
                    continue; 
                }

                const type = element.type || element.tagName.toLowerCase();
                const isRadio = type === 'radio' || type === 'mat-radio-button';
                const isCheckbox = type === 'checkbox' || type === 'mat-checkbox';
                const isFile = type === 'file';
                const groupId = getGroupId(element);
                const rawLabel = getFieldLabel(element);
                const cleanLabel = sanitize(rawLabel);
                const uniqueId = element.id || rawLabel;

                if (interactedFields.has(uniqueId)) continue;

                // 📂 FILE UPLOAD
                if (isFile) {
                    if (element.files && element.files.length > 0) continue; 
                    await uploadRealFile(element);
                    interactedFields.add(uniqueId);
                    continue; 
                }

                // 🛑 STRICT RADIO LOGIC
                if (isRadio && groupId) {
                    if (lockedGroups.has(groupId)) continue; 
                    
                    let isSiblingChecked = false;
                    if (groupId.startsWith('NAME:')) {
                        const name = groupId.split(':')[1];
                        if (document.querySelector(`input[name="${name}"]:checked`)) isSiblingChecked = true;
                    } else if (groupId.startsWith('MAT:')) {
                        const matId = groupId.split(':')[1];
                        const grp = document.getElementById(matId);
                        if (grp && grp.querySelector('.mat-radio-checked')) isSiblingChecked = true;
                    }

                    if (isSiblingChecked || isChecked(element)) {
                        console.log(`🔒 Radio group locked: ${rawLabel}`);
                        lockedGroups.add(groupId);
                        continue;
                    }
                }

                // 🛑 AGGRESSIVE CHECKBOX LOGIC
                if (isCheckbox) {
                    if (isChecked(element)) {
                        continue; 
                    } else {
                        console.log(`✅ Force-checking checkbox: ${rawLabel}`);
                        await smartClick(element);
                        interactedFields.add(uniqueId);
                        continue; 
                    }
                }

                // 🛑 TEXT FIELD LOGIC
                if (!isRadio && !isCheckbox && !isFile) {
                    let curVal = element.value || "";
                    let cleanVal = curVal.replace(/[_\-\/\s]/g, '');
                    if (cleanVal.length > 0 && !curVal.includes("Test") && !curVal.includes("Unknown") && !curVal.includes("N/A")) {
                        continue;
                    }
                }

                let valueToFill = null;
                let shouldInteract = false;

                if (isFallback) {
                    shouldInteract = true;
                    if (isRadio) valueToFill = "true";
                    else {
                        const key = Object.keys(fillData).find(k => cleanLabel.includes(sanitize(k)));
                        valueToFill = key ? fillData[key] : "Test Value";
                    }
                } else {
                    const match = aiKeys.find(k => (cleanLabel.includes(k) && k.length > 3) || k === cleanLabel);
                    if (match) {
                        shouldInteract = true;
                        const originalKey = Object.keys(fillData).find(k => sanitize(k) === match);
                        valueToFill = fillData[originalKey];
                    }
                }

                if (shouldInteract) {
                    if (rawLabel.includes("MM/DD/YYYY") || cleanLabel.includes("mmddyyyy")) valueToFill = "01/01/1990";
                    if (valueToFill === "N/A" && (cleanLabel.includes('date') || cleanLabel.includes('dob'))) valueToFill = "01/01/1990";
                }

                if (shouldInteract && valueToFill) {
                    try {
                        if (isRadio) {
                            const valStr = String(valueToFill).toLowerCase();
                            await smartClick(element);
                            interactedFields.add(uniqueId);
                            if (groupId) lockedGroups.add(groupId); 
                        } 
                        // ============================================================
                        // 🔽 DROPDOWN FIX: EXPLICIT CLICK
                        // ============================================================
                        else if (element.tagName === 'MAT-SELECT') {
                            const dropdownId = `DROP:${uniqueId}`;
                            if (lockedGroups.has(dropdownId)) continue;
                            const currentText = element.innerText || "";
                            if (!currentText.toLowerCase().includes('select') && currentText.length > 2) {
                                lockedGroups.add(dropdownId);
                                continue;
                            }
                            console.log(`🔽 Dropdown: ${rawLabel}`);
                            
                            // 1. Click to Open
                            element.click();
                            await wait(500); // Wait for animation

                            // 2. Find and Click First Option
                            const options = document.querySelectorAll('mat-option');
                            if (options.length > 0) {
                                console.log("   -> Clicking Option 1");
                                // We click the first available option
                                options[0].click();
                            } else {
                                // Fallback if no options found in DOM (rare)
                                console.log("   -> Fallback to Enter Key");
                                element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
                                await wait(100);
                                element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                            }

                            // 3. Ensure Close (Press Escape)
                            await wait(200);
                            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));

                            lockedGroups.add(dropdownId);
                            interactedFields.add(uniqueId);
                        } 
                        else {
                            let textVal = String(valueToFill);
                            console.log(`✍️ Processing Text: "${rawLabel}"`);
                            setNativeValue(element, textVal, rawLabel); 
                            interactedFields.add(uniqueId);
                        }
                    } catch (e) { console.error("Error", e); }
                }
            }
        }

        function attemptToClickNext() {
            if (document.querySelector('mat-dialog-container, .modal, .popup')) return;
            const elements = document.querySelectorAll('button, a, input[type="submit"]');
            let nextBtn = null;
            for (const el of elements) {
                const text = el.innerText.trim();
                if (NEXT_BUTTON_SELECTORS.some(kw => text === kw)) {
                    nextBtn = el; break;
                }
            }
            if (nextBtn) {
                console.log("👉 Clicking Next Button...");
                nextBtn.click();
            }
        }

        function startObserver() {
            if (observer) observer.disconnect();
            observer = new MutationObserver((mutations) => {
                let shouldUpdate = false;
                for (const m of mutations) {
                    if (m.addedNodes.length > 0 && document.querySelector('input, select')) {
                        shouldUpdate = true; break;
                    }
                }
                if (shouldUpdate) {
                    observer.disconnect();
                    setTimeout(() => { autoFillAndNavigate(); startObserver(); }, 2000);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'startAutoFill') {
                autoFillAndNavigate();
                startObserver();
                sendResponse({ success: true });
            }
        });
    })();
}
