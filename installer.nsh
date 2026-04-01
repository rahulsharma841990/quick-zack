; QuickZack NSIS Installer Customization
; This file is included by electron-builder during the installer build

!macro customHeader
  !system "echo QuickZack Installer"
!macroend

!macro customInit
  ; Check if app is already running and close it before install
  nsProcess::FindProcess "QuickZack.exe"
  Pop $R0
  ${If} $R0 = 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "QuickZack is currently running.$\n$\nClick OK to close it and continue the installation, or Cancel to abort." \
      IDOK close_app IDCANCEL abort_install
    close_app:
      nsProcess::KillProcess "QuickZack.exe"
      Pop $R0
      Sleep 1000
      Goto continue_install
    abort_install:
      Abort
    continue_install:
  ${EndIf}
!macroend

!macro customInstall
  ; Write app version to registry
  WriteRegStr HKCU "Software\QuickZack" "Version" "${VERSION}"
  WriteRegStr HKCU "Software\QuickZack" "InstallPath" "$INSTDIR"
!macroend

!macro customUnInstall
  ; Clean up registry on uninstall
  DeleteRegKey HKCU "Software\QuickZack"
!macroend
