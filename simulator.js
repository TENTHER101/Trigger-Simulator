// --- Helper function to parse channel strings ---
const parseChannels = (channelString) => {
    if (!channelString || typeof channelString !== 'string') return [];
    return channelString.split(',').map(c => c.trim()).filter(c => c);
};

class Trigger {
    constructor(config) {
        this.id = config.id;
        this.delay = config.delay || 0;
        this.activateOn = parseChannels(config.activateOn);
        this.deactivateOn = parseChannels(config.deactivateOn);
        this.triggerOn = parseChannels(config.triggerOn);
        this.whenTriggered = config.whenTriggered || null;
        
        this.initialState = config.initialState || false;
        this.state = this.initialState;
        
        this.x = config.x;
        this.y = config.y;

        this.element = this.createElement();
        this.updateUI();
    }

    createElement() {
        const div = document.createElement('div');
        div.id = `trigger-${this.id}`;
        div.className = 'trigger p-3 rounded-lg border-2 flex flex-col';
        document.getElementById('zoom-container').appendChild(div);

        div.addEventListener('click', (e) => {
            e.stopPropagation();
            simulator.selectTrigger(this);
        });
        div.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            simulator.startDrag(e, this);
        });
        return div;
    }

    handlePulse(channel, eventQueue, currentTime) {
        let handled = false;
        if (channel && this.activateOn.includes(channel)) {
            this.state = true;
            simulator.logEvent(`T=${currentTime}: '${this.id}' ACTIVATED by channel '${channel}'.`);
            this.updateUI();
            handled = true;
        }
        if (channel && this.deactivateOn.includes(channel)) {
            this.state = false;
            simulator.logEvent(`T=${currentTime}: '${this.id}' DEACTIVATED by channel '${channel}'.`);
            this.updateUI();
            handled = true;
        }
        if (channel && this.triggerOn.includes(channel) && this.state) {
            simulator.logEvent(`T=${currentTime}: '${this.id}' TRIGGERED by channel '${channel}'.`);
            if (this.whenTriggered) {
                const fireTime = currentTime + this.delay;
                simulator.logEvent(`  - Scheduling pulse on '${this.whenTriggered}' at T=${fireTime}`);
                eventQueue.push({ time: fireTime, channel: this.whenTriggered, sourceId: this.id });
            }
            handled = true;
        }
        return handled;
    }

    updateUI() {
        if (!this.element) return;
        this.element.style.left = `${this.x}px`;
        this.element.style.top = `${this.y}px`;
        this.element.classList.toggle('active', this.state);
        this.element.classList.toggle('inactive', !this.state);
        this.element.innerHTML = `
            <div class="font-bold text-lg text-center">${this.id}</div>
            <div class="text-xs mt-1 font-mono">State: ${this.state ? 'ACTIVE' : 'INACTIVE'}</div>
            <div class="text-xs mt-1 font-mono">Delay: ${this.delay}</div>
            <div class="text-xs mt-2 grid grid-cols-2 gap-x-2">
                <span>Act on:</span> <span class="text-emerald-300">${this.activateOn.join(', ') || 'N/A'}</span>
                <span>Deact on:</span> <span class="text-red-300">${this.deactivateOn.join(', ') || 'N/A'}</span>
                <span>Trig on:</span> <span class="text-amber-300">${this.triggerOn.join(', ') || 'N/A'}</span>
                <span>Fires:</span> <span class="text-sky-300">${this.whenTriggered || 'N/A'}</span>
            </div>
            <div class="grid grid-cols-2 gap-2 mt-2">
                <button class="action-btn toggle-state-btn py-1 text-xs bg-gray-500 hover:bg-gray-400 rounded">Toggle State</button>
                <button class="action-btn manual-trigger-btn py-1 text-xs bg-amber-600 hover:bg-amber-500 rounded">Trigger</button>
            </div>
        `;
        // Add event listeners to the new buttons
        this.element.querySelector('.toggle-state-btn').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent selection when toggling
            if (simulator.isSimulating) return;
            this.state = !this.state;
            this.initialState = this.state; // Update initial state for resets
            this.updateUI();
            simulator.logEvent(`Manually toggled '${this.id}' to ${this.state ? 'Active' : 'Inactive'}.`);
        });
        this.element.querySelector('.manual-trigger-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            simulator.manuallyTrigger(this.id);
        });
    }
    
    reset() {
        this.state = this.initialState;
        this.updateUI();
    }

    flash(type) {
        const className = type === 'fire' ? 'pulsing-fire' : 'pulsing-listen';
        this.element.classList.add(className);
        setTimeout(() => this.element.classList.remove(className), 700);
    }

    // For saving the layout
    serialize() {
        return {
            id: this.id,
            delay: this.delay,
            activateOn: this.activateOn.join(', '),
            deactivateOn: this.deactivateOn.join(', '),
            triggerOn: this.triggerOn.join(', '),
            whenTriggered: this.whenTriggered,
            initialState: this.initialState,
            x: this.x,
            y: this.y,
        };
    }
}

class Simulator {
    constructor() {
        this.triggers = {};
        this.eventQueue = [];
        this.time = 0;
        this.isSimulating = false;
        this.selectedTrigger = null;
        this.activeTimeouts = []; // To track all scheduled events
        
        // UI Elements
        this.logOutput = document.getElementById('log-output');
        this.canvas = document.getElementById('simulationCanvas');
        this.zoomContainer = document.getElementById('zoom-container');
        this.editPanel = document.getElementById('edit-panel');
        this.editForm = document.getElementById('edit-trigger-form');

        // Pan and Zoom state
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        
        // Dragging Triggers
        this.draggedTrigger = null;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;

        this.setupListeners();
    }
    
    setupListeners() {
        this.canvas.addEventListener('wheel', (e) => this.handleZoom(e), { passive: false });
        this.canvas.addEventListener('mousedown', (e) => this.handlePanStart(e));
        window.addEventListener('mousemove', (e) => this.handlePanMove(e));
        window.addEventListener('mouseup', (e) => this.handlePanEnd(e));
        window.addEventListener('keydown', (e) => { if (e.code === 'Space') this.canvas.classList.add('panning'); });
        window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.canvas.classList.remove('panning'); });
        this.canvas.addEventListener('click', () => this.selectTrigger(null));
    }

    // --- Pan and Zoom ---
    handleZoom(e) {
        e.preventDefault();
        const zoomIntensity = 0.1;
        const delta = e.deltaY > 0 ? -1 : 1;
        const newScale = this.scale + delta * zoomIntensity;
        this.scale = Math.max(0.2, Math.min(newScale, 3));
        this.updateTransform();
    }

    handlePanStart(e) {
        if (e.code === 'Space' || e.buttons === 4 || e.target.id === 'simulationCanvas') { // Spacebar, Middle mouse, or direct canvas click
            this.isPanning = true;
            this.panStartX = e.clientX - this.panX;
            this.panStartY = e.clientY - this.panY;
            this.canvas.classList.add('panning');
        }
    }

    handlePanMove(e) {
        if (this.isPanning) {
            this.panX = e.clientX - this.panStartX;
            this.panY = e.clientY - this.panStartY;
            this.updateTransform();
        } else if(this.draggedTrigger) {
            this.dragTrigger(e);
        }
    }

    handlePanEnd() {
        this.isPanning = false;
        this.canvas.classList.remove('panning');
        this.endDrag();
    }

    updateTransform() {
        this.zoomContainer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    }

    // --- Trigger Dragging ---
    startDrag(event, trigger) {
        if(this.isPanning) return;
        this.draggedTrigger = trigger;
        const rect = trigger.element.getBoundingClientRect();
        this.dragOffsetX = (event.clientX - rect.left) / this.scale;
        this.dragOffsetY = (event.clientY - rect.top) / this.scale;
    }

    dragTrigger(event) {
        if (this.draggedTrigger) {
            event.preventDefault();
            const canvasRect = this.canvas.getBoundingClientRect();
            let x = (event.clientX - canvasRect.left) / this.scale - this.dragOffsetX - (this.panX / this.scale);
            let y = (event.clientY - canvasRect.top) / this.scale - this.dragOffsetY - (this.panY / this.scale);
            
            this.draggedTrigger.x = x;
            this.draggedTrigger.y = y;
            this.draggedTrigger.updateUI();
        }
    }

    endDrag() {
        this.draggedTrigger = null;
    }

    // --- Core Simulation ---
    addTrigger(config) {
        if (!config.id || this.triggers[config.id]) {
            alert('Invalid or duplicate trigger ID.');
            return null;
        }
        const trigger = new Trigger(config);
        this.triggers[config.id] = trigger;
        this.logEvent(`Trigger '${config.id}' created.`);
        return trigger;
    }
    
    deleteTrigger(triggerId) {
        if (!this.triggers[triggerId]) return;
        const trigger = this.triggers[triggerId];
        trigger.element.remove();
        delete this.triggers[triggerId];
        this.selectTrigger(null); // Deselect
        this.logEvent(`Deleted trigger '${triggerId}'.`);
    }

    pulseChannel(channel, time = 0) {
        if (this.isSimulating) {
            this.logEvent("Cannot pulse; simulation is already running.", "bold");
            return;
        }
        if (!channel) {
            alert("Channel name cannot be empty.");
            return;
        }
        this.isSimulating = true;
        this.logEvent(`⚡ Injecting initial pulse on channel '${channel}' at T=${time}`, 'bold');
        this.eventQueue.push({ time, channel, sourceId: 'EXTERNAL' });
        this.run();
    }
    
    manuallyTrigger(triggerId) {
        if (this.isSimulating) {
            this.logEvent("Cannot manually trigger; simulation is already running.", "bold");
            return;
        }

        const trigger = this.triggers[triggerId];
        if (!trigger) return;

        if (!trigger.state) {
            this.logEvent(`Cannot manually trigger '${triggerId}'; it is inactive.`, "bold");
            return;
        }

        this.isSimulating = true;
        this.logEvent(`⚡ Manually triggering '${triggerId}' at T=${this.time}`, 'bold');
        
        if (trigger.whenTriggered) {
            const fireTime = this.time + trigger.delay;
            this.logEvent(`  - Scheduling pulse on '${trigger.whenTriggered}' at T=${fireTime}`);
            this.eventQueue.push({ time: fireTime, channel: trigger.whenTriggered, sourceId: trigger.id });
        }
        
        trigger.flash('fire'); // Give visual feedback
        this.run();
    }

    run() {
        if (this.eventQueue.length === 0) {
            this.logEvent('--- Simulation End ---', 'bold');
            this.isSimulating = false;
            return;
        }

        this.eventQueue.sort((a, b) => a.time - b.time);
        const { time, channel, sourceId } = this.eventQueue.shift();
        this.time = time;
        
        this.logEvent(`--- Processing T=${time}, Channel='${channel}' ---`, 'bold');
        
        // Visualize pulse
        if(this.triggers[sourceId]) this.triggers[sourceId].flash('fire');
        Object.values(this.triggers).forEach(t => {
            if (t.activateOn.includes(channel) || t.deactivateOn.includes(channel) || t.triggerOn.includes(channel)) {
                t.flash('listen');
            }
        });

        const timeoutId = setTimeout(() => {
            // Remove self from active timeouts list
            this.activeTimeouts.shift(); 
            
            let handledAtLeastOnce = false;
            Object.values(this.triggers).forEach(trigger => {
                const handled = trigger.handlePulse(channel, this.eventQueue, this.time);
                if (handled) handledAtLeastOnce = true;
            });
            if (!handledAtLeastOnce) {
                this.logEvent(`  - Pulse on '${channel}' was not handled by any trigger.`);
            }
            this.run();
        }, 700);
        this.activeTimeouts.push(timeoutId);
    }
    
    // --- UI and State Management ---
    selectTrigger(trigger) {
        if (this.selectedTrigger) {
            this.selectedTrigger.element.classList.remove('selected');
        }
        this.selectedTrigger = trigger;
        if (trigger) {
            trigger.element.classList.add('selected');
            this.populateEditPanel(trigger);
            this.editPanel.classList.remove('hidden');
        } else {
            this.editPanel.classList.add('hidden');
        }
    }

    populateEditPanel(trigger) {
        this.editForm.innerHTML = `
            <div class="font-bold text-lg text-blue-300">${trigger.id}</div>
            <div><label class="text-sm">Delay</label><input type="number" data-property="delay" class="w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-2" value="${trigger.delay}"></div>
            <div><label class="text-sm">Activate On</label><input type="text" data-property="activateOn" class="w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-2" value="${trigger.activateOn.join(', ') || ''}"></div>
            <div><label class="text-sm">Deactivate On</label><input type="text" data-property="deactivateOn" class="w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-2" value="${trigger.deactivateOn.join(', ') || ''}"></div>
            <div><label class="text-sm">Trigger On</label><input type="text" data-property="triggerOn" class="w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-2" value="${trigger.triggerOn.join(', ') || ''}"></div>
            <div><label class="text-sm">When Triggered</label><input type="text" data-property="whenTriggered" class="w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-2" value="${trigger.whenTriggered || ''}"></div>
            <button id="delete-trigger-btn" class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors mt-4">Delete Trigger</button>
        `;
        this.editForm.querySelectorAll('input').forEach(input => {
            input.addEventListener('change', (e) => this.updateTriggerProperty(e));
        });
        this.editForm.querySelector('#delete-trigger-btn').addEventListener('click', () => {
            this.deleteTrigger(this.selectedTrigger.id);
        });
    }
    
    updateTriggerProperty(e) {
        if (!this.selectedTrigger) return;
        const property = e.target.dataset.property;
        let value = e.target.value;

        if (e.target.type === 'number') {
            value = parseInt(value);
        } else if (['activateOn', 'deactivateOn', 'triggerOn'].includes(property)) {
            this.selectedTrigger[property] = parseChannels(value);
        } else {
            this.selectedTrigger[property] = value || null;
        }
        
        if(!Array.isArray(this.selectedTrigger[property])) {
            this.selectedTrigger[property] = value;
        }

        this.selectedTrigger.updateUI();
        this.logEvent(`Updated '${property}' for trigger '${this.selectedTrigger.id}'.`);
    }

    clear() {
        this.isSimulating = false;
        // Cancel all pending events before clearing
        this.activeTimeouts.forEach(id => clearTimeout(id));
        this.activeTimeouts = [];
        this.eventQueue = [];
        this.time = 0;
        this.logOutput.innerHTML = '';
        this.zoomContainer.innerHTML = '';
        this.triggers = {};
        this.selectTrigger(null);
    }

    resetSimulation() {
        this.isSimulating = false;
        // Cancel all pending events before resetting
        this.activeTimeouts.forEach(id => clearTimeout(id));
        this.activeTimeouts = [];
        this.eventQueue = [];
        this.time = 0;
        this.logOutput.innerHTML = '';
        Object.values(this.triggers).forEach(trigger => trigger.reset());
        this.logEvent('Simulation reset to initial states.');
    }

    logEvent(message, style = '') {
        const entry = document.createElement('div');
        entry.textContent = message;
        if (style === 'bold') entry.classList.add('font-bold', 'text-emerald-400');
        this.logOutput.prepend(entry);
    }

    // --- Save/Load Logic ---
    saveLayout() {
        const layoutData = Object.values(this.triggers).map(t => t.serialize());
        const jsonString = JSON.stringify(layoutData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'trigger-layout.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.logEvent('Layout saved to trigger-layout.json');
    }

    loadLayout(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const layoutData = JSON.parse(e.target.result);
                if (!Array.isArray(layoutData)) throw new Error("Invalid format");
                
                this.clear();
                layoutData.forEach(config => this.addTrigger(config));
                this.logEvent(`Layout loaded from ${file.name}`);
            } catch (error) {
                alert('Failed to load layout. The file may be corrupted or in the wrong format.');
                console.error("Load error:", error);
            }
        };
        reader.readAsText(file);
    }
}

// --- Initialization ---
const simulator = new Simulator();

document.getElementById('add-trigger-button').addEventListener('click', () => {
    const form = document.getElementById('add-trigger-form');
    const config = {
        id: form.querySelector('[data-property="id"]').value.trim(),
        delay: parseInt(form.querySelector('[data-property="delay"]').value),
        activateOn: form.querySelector('[data-property="activateOn"]').value.trim(),
        deactivateOn: form.querySelector('[data-property="deactivateOn"]').value.trim(),
        triggerOn: form.querySelector('[data-property="triggerOn"]').value.trim(),
        whenTriggered: form.querySelector('[data-property="whenTriggered"]').value.trim(),
        x: Math.random() * 300 + 50,
        y: Math.random() * 300 + 50,
    };
    if (simulator.addTrigger(config)) {
        form.querySelector('[data-property="id"]').value = ''; // Clear ID on success
    }
});

document.getElementById('pulse-channel-button').addEventListener('click', () => {
    const channelName = document.getElementById('pulse-channel-name').value.trim();
    simulator.pulseChannel(channelName);
});

document.getElementById('reset-button').addEventListener('click', () => simulator.resetSimulation());

document.getElementById('save-layout-button').addEventListener('click', () => simulator.saveLayout());
document.getElementById('load-layout-input').addEventListener('change', (e) => simulator.loadLayout(e.target.files[0]));

// Load a default example
window.addEventListener('load', () => {
    simulator.logEvent("Simulator loaded. Building an AND gate example.");
    simulator.addTrigger({ id: 'T_A_MEM', activateOn: 'A_ON', deactivateOn: 'RESET', x: 50, y: 100, initialState: true });
    simulator.addTrigger({ id: 'T_B_MEM', activateOn: 'B_ON', deactivateOn: 'RESET', x: 50, y: 250, initialState: true });
    simulator.addTrigger({ id: 'T_CHAIN', activateOn: 'A_ON', deactivateOn: 'RESET', triggerOn: 'B_ON', whenTriggered: 'AND_SUCCESS', delay: 2, x: 300, y: 175 });
    simulator.addTrigger({ id: 'T_RESULT', activateOn: 'AND_SUCCESS', deactivateOn: 'RESET', x: 550, y: 175 });
    simulator.logEvent("AND Gate loaded. Pulse 'RESET', then 'A_ON', then 'B_ON' to test.");
});

// --- UI: View toggle for Home / Docs (moved from index.html) ---
document.addEventListener('DOMContentLoaded', () => {
    // Defensive: elements may not exist if index.html layout changes
    const homeBtn = document.getElementById('nav-home');
    const docsBtn = document.getElementById('nav-docs');
    const homeView = document.getElementById('home-view');
    const docsView = document.getElementById('docs-view');
    const currentView = document.getElementById('current-view');

    if (!homeBtn || !docsBtn || !homeView || !docsView || !currentView) return;

    function showHome(){
        homeView.classList.remove('hidden');
        docsView.classList.add('hidden');
        homeBtn.classList.add('bg-emerald-600', 'text-white');
        homeBtn.classList.remove('text-gray-300');
        docsBtn.classList.remove('bg-emerald-600', 'text-white');
        docsBtn.classList.add('text-gray-300');
        currentView.textContent = 'Home';
    }

    function showDocs(){
        docsView.classList.remove('hidden');
        homeView.classList.add('hidden');
        docsBtn.classList.add('bg-emerald-600', 'text-white');
        docsBtn.classList.remove('text-gray-300');
        homeBtn.classList.remove('bg-emerald-600', 'text-white');
        homeBtn.classList.add('text-gray-300');
        currentView.textContent = 'Docs';
    }

    homeBtn.addEventListener('click', showHome);
    docsBtn.addEventListener('click', showDocs);

    // initialize
    showHome();
});