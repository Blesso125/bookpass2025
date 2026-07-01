// Update Status Manager for BookPass
class UpdateManager {
    constructor() {
        this.currentVersion = localStorage.getItem('bookpass_version') || '1.0.0';
        this.githubRepo = window.BOOKPASS_GITHUB_REPO || 'bookpass2025';
        this.githubBranch = window.BOOKPASS_GITHUB_BRANCH || 'main';
        this.filesToUpdate = [
            'index.html',
            'dashboard.html',
            'inventory.html',
            'checkout.html',
            'checkin.html',
            'analytics.html',
            'admin.html',
            'about.html',
            'contact.html',
            'styles/main.css',
            'scripts/storage.js',
            'scripts/navigation.js',
            'scripts/dashboard.js',
            'scripts/analytics.js',
            'scripts/inventory.js',
            'scripts/checkout.js',
            'scripts/checkin.js'
        ];
        this.updateCache = {};
        this.fs = this.getFsModule();
        this.path = this.fs ? require('path') : null;
        this.appRoot = this.path && typeof __dirname !== 'undefined'
            ? this.path.resolve(__dirname, '..')
            : (this.path ? process.cwd() : null);
        this.init();
    }

    getFsModule() {
        try {
            if (typeof require !== 'undefined') {
                return require('fs');
            }
        } catch (error) {
            console.warn('Node fs module unavailable:', error);
        }
        return null;
    }

    buildUpdateUrl(filePath = 'version.json') {
        const configuredUrl = window.BOOKPASS_UPDATE_URL || window.BOOKPASS_VERSION_URL || window.BOOKPASS_GITHUB_VERSION_URL;
        if (configuredUrl) {
            const base = configuredUrl.replace(/\/$/, '');
            return filePath === 'version.json' && configuredUrl.endsWith('.json')
                ? configuredUrl
                : `${base}/${filePath}`;
        }

        const repo = window.BOOKPASS_GITHUB_REPO || this.githubRepo;
        const branch = window.BOOKPASS_GITHUB_BRANCH || this.githubBranch || 'main';
        if (repo) {
            return `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`;
        }

        return filePath;
    }

    init() {
        this.bindEvents();
        this.checkForUpdates(false);
        // Check for updates every 5 minutes
        setInterval(() => this.checkForUpdates(false), 5 * 60 * 1000);
    }

    bindEvents() {
        const checkBtn = document.getElementById('checkForUpdatesBtn');
        const applyBtn = document.getElementById('applyUpdateBtn');
        const rollbackBtn = document.getElementById('rollbackUpdateBtn');

        if (checkBtn) {
            checkBtn.addEventListener('click', () => this.checkForUpdates(true));
        }

        if (applyBtn) {
            applyBtn.addEventListener('click', () => this.applyUpdates());
        }

        if (rollbackBtn) {
            rollbackBtn.addEventListener('click', () => this.rollbackUpdate());
        }
    }

    async checkForUpdates(showNotification = true) {
        try {
            this.setStatus('Checking for updates...');
            this.setLoading(true);

            // Fetch version info from GitHub
            const versionInfo = await this.fetchVersionInfo();
            
            if (!versionInfo) {
                throw new Error('Unable to fetch version information');
            }

            const latestVersion = versionInfo.version;
            const releaseNotes = versionInfo.releaseNotes || 'No release notes available.';
            const updateDate = versionInfo.updateDate || new Date().toISOString();

            // Update UI
            this.updateVersionDisplay(latestVersion, releaseNotes, updateDate);

            // Check if update is available
            if (this.isNewerVersion(latestVersion, this.currentVersion)) {
                this.setStatus(`New version ${latestVersion} available! Click "Apply Update" to install.`, 'warning');
                this.showUpdateAvailable(latestVersion);
                
                if (showNotification && window.navigationManager) {
                    window.navigationManager.showNotification(
                        `Update available: Version ${latestVersion}`,
                        'info'
                    );
                }
            } else {
                this.setStatus('Your app is up to date!', 'success');
                this.hideUpdateAvailable();
                
                if (showNotification && window.navigationManager) {
                    window.navigationManager.showNotification(
                        'BookPass is up to date.',
                        'success'
                    );
                }
            }
        } catch (error) {
            console.error('Update check failed:', error);
            this.setStatus('Failed to check for updates. Please try again later.', 'error');
            if (showNotification && window.navigationManager) {
                window.navigationManager.showNotification(
                    'Unable to check for updates.',
                    'error'
                );
            }
        } finally {
            this.setLastChecked();
            this.setLoading(false);
        }
    }

    async fetchVersionInfo() {
        try {
            const versionUrl = this.buildUpdateUrl('version.json');
            const response = await fetch(`${versionUrl}?t=${Date.now()}`);

            if (!response.ok) {
                throw new Error('Version file not found');
            }

            const data = await response.json();

            if (data.files) {
                this.updateCache.files = data.files;
            }

            return data;
        } catch (error) {
            console.warn('Could not fetch version from update source, using fallback:', error);

            try {
                const localResponse = await fetch('version.json');
                if (localResponse.ok) {
                    return await localResponse.json();
                }
            } catch (localError) {
                console.warn('Local version file not found:', localError);
            }

            return null;
        }
    }

    async fetchFileContent(filePath) {
        try {
            const url = this.buildUpdateUrl(filePath);
            const response = await fetch(`${url}?t=${Date.now()}`);

            if (!response.ok) {
                throw new Error(`Failed to fetch ${filePath}`);
            }

            return await response.text();
        } catch (error) {
            console.error(`Error fetching ${filePath}:`, error);
            return null;
        }
    }

    async applyUpdates() {
        try {
            this.setStatus('Downloading updates...', 'info');
            this.setLoading(true);

            const versionInfo = await this.fetchVersionInfo();
            if (!versionInfo) {
                throw new Error('Unable to fetch update information');
            }

            const filesToUpdate = versionInfo.files || this.filesToUpdate;
            let updateCount = 0;
            let errorCount = 0;

            await this.createBackup();

            for (const file of filesToUpdate) {
                this.setStatus(`Downloading ${file}...`, 'info');
                const content = await this.fetchFileContent(file);

                if (content) {
                    if (await this.saveFile(file, content)) {
                        updateCount++;
                    } else {
                        errorCount++;
                        console.warn(`Failed to save ${file}`);
                    }
                } else {
                    errorCount++;
                    console.warn(`Failed to download ${file}`);
                }
            }

            if (versionInfo.version) {
                this.currentVersion = versionInfo.version;
                localStorage.setItem('bookpass_version', versionInfo.version);
                localStorage.setItem('bookpass_update_date', new Date().toISOString());
            }

            this.updateVersionDisplay(versionInfo.version, versionInfo.releaseNotes || 'No release notes available.', versionInfo.updateDate || new Date().toISOString());

            this.setStatus(`Update complete! ${updateCount} files updated.`, errorCount === 0 ? 'success' : 'warning');

            if (window.navigationManager) {
                window.navigationManager.showNotification(
                    `Update applied successfully! ${updateCount} files updated.`,
                    'success'
                );
            }

            this.showReloadButton();

        } catch (error) {
            console.error('Update failed:', error);
            this.setStatus('Update failed. Please try again.', 'error');

            if (window.navigationManager) {
                window.navigationManager.showNotification(
                    'Update failed. Please try again.',
                    'error'
                );
            }
        } finally {
            this.setLastChecked();
            this.setLoading(false);
        }
    }

    async createBackup() {
        try {
            const backupKey = `bookpass_backup_${Date.now()}`;
            const backup = {
                timestamp: new Date().toISOString(),
                version: this.currentVersion,
                files: {}
            };

            const filesToBackup = ['index.html', 'dashboard.html', 'inventory.html', 'checkout.html', 'checkin.html', 'about.html', 'admin.html', 'contact.html', 'analytics.html', 'styles/main.css', 'scripts/storage.js', 'scripts/navigation.js', 'scripts/dashboard.js', 'scripts/analytics.js', 'scripts/inventory.js', 'scripts/checkout.js', 'scripts/checkin.js'];
            for (const file of filesToBackup) {
                try {
                    if (this.fs && this.path && this.appRoot) {
                        const localPath = this.path.join(this.appRoot, ...file.split('/'));
                        const content = await this.fs.promises.readFile(localPath, 'utf8');
                        backup.files[file] = content;
                    } else {
                        const response = await fetch(file);
                        if (response.ok) {
                            backup.files[file] = await response.text();
                        }
                    }
                } catch (e) {
                    console.warn(`Could not backup ${file}:`, e);
                }
            }

            localStorage.setItem(backupKey, JSON.stringify(backup));
            localStorage.setItem('bookpass_last_backup', backupKey);
            this.cleanupOldBackups();
        } catch (error) {
            console.warn('Backup creation failed:', error);
        }
    }

    cleanupOldBackups() {
        try {
            const backups = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('bookpass_backup_')) {
                    backups.push(key);
                }
            }
            
            // Sort by timestamp (newest first)
            backups.sort((a, b) => {
                const timeA = parseInt(a.split('_').pop());
                const timeB = parseInt(b.split('_').pop());
                return timeB - timeA;
            });
            
            // Keep only last 5 backups
            while (backups.length > 5) {
                const oldBackup = backups.pop();
                localStorage.removeItem(oldBackup);
            }
        } catch (error) {
            console.warn('Backup cleanup failed:', error);
        }
    }

    async rollbackUpdate() {
        try {
            const backupKey = localStorage.getItem('bookpass_last_backup');
            if (!backupKey) {
                throw new Error('No backup found');
            }

            const backupData = localStorage.getItem(backupKey);
            if (!backupData) {
                throw new Error('Backup data not found');
            }

            const backup = JSON.parse(backupData);
            for (const [file, content] of Object.entries(backup.files)) {
                await this.saveFile(file, content);
            }

            if (backup.version) {
                this.currentVersion = backup.version;
                localStorage.setItem('bookpass_version', backup.version);
            }

            this.setStatus('Rollback successful!', 'success');
            
            if (window.navigationManager) {
                window.navigationManager.showNotification(
                    'Rollback successful!',
                    'success'
                );
            }

            this.showReloadButton();

        } catch (error) {
            console.error('Rollback failed:', error);
            this.setStatus('Rollback failed.', 'error');
            
            if (window.navigationManager) {
                window.navigationManager.showNotification(
                    'Rollback failed.',
                    'error'
                );
            }
        }
    }

    async saveFile(filePath, content) {
        try {
            if (this.fs && this.path && this.appRoot) {
                const targetPath = this.path.join(this.appRoot, ...filePath.split('/'));
                const targetDir = this.path.dirname(targetPath);
                await this.fs.promises.mkdir(targetDir, { recursive: true });
                await this.fs.promises.writeFile(targetPath, content, 'utf8');
                return true;
            }

            const fileKey = `bookpass_file_${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`;
            localStorage.setItem(fileKey, content);
            const fileInfoKey = `bookpass_file_info_${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`;
            localStorage.setItem(fileInfoKey, JSON.stringify({
                path: filePath,
                updatedAt: new Date().toISOString(),
                version: this.currentVersion
            }));
            return true;
        } catch (error) {
            console.error(`Failed to save ${filePath}:`, error);
            return false;
        }
    }

    isNewerVersion(latest, current) {
        const latestParts = latest.split('.').map(p => parseInt(p, 10) || 0);
        const currentParts = current.split('.').map(p => parseInt(p, 10) || 0);
        
        for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
            const latestVal = latestParts[i] || 0;
            const currentVal = currentParts[i] || 0;
            if (latestVal > currentVal) return true;
            if (latestVal < currentVal) return false;
        }
        return false;
    }

    updateVersionDisplay(latestVersion, releaseNotes, updateDate) {
        const latestLabel = document.getElementById('latestVersionLabel');
        const releaseNotesLabel = document.getElementById('releaseNotesLabel');
        const updateDateLabel = document.getElementById('updateDateLabel');
        const currentVersionLabel = document.getElementById('currentVersionLabel');
        const currentVersionText = document.getElementById('currentVersionText');

        if (currentVersionLabel) {
            currentVersionLabel.textContent = this.currentVersion;
        }
        if (currentVersionText) {
            currentVersionText.textContent = this.currentVersion;
        }
        
        if (latestLabel) {
            latestLabel.textContent = latestVersion || 'Unknown';
        }
        
        if (releaseNotesLabel) {
            releaseNotesLabel.textContent = releaseNotes;
        }
        
        if (updateDateLabel) {
            updateDateLabel.textContent = updateDate ? new Date(updateDate).toLocaleString() : 'Unknown';
        }
    }

    showUpdateAvailable(version) {
        const applyBtn = document.getElementById('applyUpdateBtn');
        const rollbackBtn = document.getElementById('rollbackUpdateBtn');
        const updateStatus = document.getElementById('updateStatusText');
        
        if (applyBtn) {
            applyBtn.classList.remove('hidden');
            applyBtn.innerHTML = `<i class="fas fa-download"></i> Apply Update to ${version}`;
        }
        
        if (rollbackBtn) {
            rollbackBtn.classList.remove('hidden');
        }
        
        if (updateStatus) {
            updateStatus.className = 'update-status warning';
        }
    }

    hideUpdateAvailable() {
        const applyBtn = document.getElementById('applyUpdateBtn');
        const rollbackBtn = document.getElementById('rollbackUpdateBtn');
        const updateStatus = document.getElementById('updateStatusText');
        
        if (applyBtn) {
            applyBtn.classList.add('hidden');
        }
        
        if (rollbackBtn) {
            rollbackBtn.classList.add('hidden');
        }
        
        if (updateStatus) {
            updateStatus.className = 'update-status success';
        }
    }

    showReloadButton() {
        const reloadBtn = document.createElement('button');
        reloadBtn.className = 'primary-btn';
        reloadBtn.innerHTML = '<i class="fas fa-sync"></i> Reload App';
        reloadBtn.onclick = () => window.location.reload();
        
        const actionsContainer = document.querySelector('.update-actions');
        if (actionsContainer) {
            // Remove existing reload button if present
            const existing = actionsContainer.querySelector('.reload-btn');
            if (existing) existing.remove();
            
            reloadBtn.className = 'primary-btn reload-btn';
            actionsContainer.appendChild(reloadBtn);
        }
    }

    setStatus(message, type = 'info') {
        const statusEl = document.getElementById('updateStatusText');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = `update-status ${type}`;
        }
    }

    setLastChecked() {
        const lastCheckedLabel = document.getElementById('lastCheckedLabel');
        if (lastCheckedLabel) {
            lastCheckedLabel.textContent = new Date().toLocaleString();
        }
    }

    setLoading(loading) {
        const checkBtn = document.getElementById('checkForUpdatesBtn');
        const applyBtn = document.getElementById('applyUpdateBtn');
        
        if (checkBtn) {
            checkBtn.disabled = loading;
            checkBtn.innerHTML = loading ? 
                '<i class="fas fa-spinner fa-spin"></i> Checking...' : 
                '<i class="fas fa-search"></i> Check for updates';
        }
        
        if (applyBtn) {
            applyBtn.disabled = loading;
        }
    }
}

// Initialize update manager
document.addEventListener('DOMContentLoaded', () => {
    if (!window.updateManager) {
        window.updateManager = new UpdateManager();
    }
});