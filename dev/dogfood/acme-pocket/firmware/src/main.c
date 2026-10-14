#include "esp_log.h"
#include "nimble/ble.h"

void app_main(void) {
    ESP_LOGI("pocket", "advertising");
    ble_start_advertising();
}
