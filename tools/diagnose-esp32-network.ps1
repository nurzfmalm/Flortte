Write-Host "=== Wi-Fi interface ==="
netsh wlan show interfaces

Write-Host ""
Write-Host "=== IPv4 addresses ==="
Get-NetIPAddress -AddressFamily IPv4 |
  Select-Object InterfaceAlias, IPAddress, PrefixLength |
  Sort-Object InterfaceAlias |
  Format-Table -AutoSize

Write-Host ""
Write-Host "=== Routes for 192.168.4.1 ==="
route print -4 192.168.4.1

Write-Host ""
Write-Host "=== Proxy ==="
netsh winhttp show proxy
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' |
  Select-Object ProxyEnable, ProxyServer, AutoConfigURL |
  Format-Table -AutoSize

Write-Host ""
Write-Host "=== Ping ESP32 ==="
ping 192.168.4.1 -n 4

Write-Host ""
Write-Host "=== TCP port 80 ==="
Test-NetConnection 192.168.4.1 -Port 80 -InformationLevel Detailed

Write-Host ""
Write-Host "=== TCP port 8080 ==="
Test-NetConnection 192.168.4.1 -Port 8080 -InformationLevel Detailed

Write-Host ""
Write-Host "=== HTTP /state ==="
curl.exe --noproxy "*" --connect-timeout 5 --max-time 8 -v http://192.168.4.1/state

Write-Host ""
Write-Host "=== HTTP /state on 8080 ==="
curl.exe --noproxy "*" --connect-timeout 5 --max-time 8 -v http://192.168.4.1:8080/state
