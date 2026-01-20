#include <napi.h>
#include "nvapi.h"

// Fallback definition for NV_DRS_SETTING_VER if not already defined
#ifndef NV_DRS_SETTING_VER
#define NV_DRS_SETTING_VER 0x2000  // Approximate; check nvapi.h or docs if possible
#endif

// Fallback definition for NVDRS_SETTING_TYPE_DWORD if not in headers
#ifndef NVDRS_SETTING_TYPE_DWORD
#define NVDRS_SETTING_TYPE_DWORD 0  // Placeholder value; adjust based on NVAPI docs (typically 0 for DWORD)
#endif

Napi::Value SetDriverSetting(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Expected 3 arguments: settingId, value, isGlobal").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    uint32_t settingId = info[0].As<Napi::Number>().Uint32Value();
    uint32_t value = info[1].As<Napi::Number>().Uint32Value();
    bool isGlobal = info[2].As<Napi::Boolean>().Value();

    NvAPI_Status status = NvAPI_Initialize();
    if (status != NVAPI_OK) {
        Napi::Error::New(env, "Failed to initialize NVAPI").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    NvDRSSessionHandle hSession;
    status = NvAPI_DRS_CreateSession(&hSession);
    if (status != NVAPI_OK) {
        NvAPI_Unload();
        return env.Undefined();
    }

    status = NvAPI_DRS_LoadSettings(hSession);
    if (status != NVAPI_OK) {
        NvAPI_DRS_DestroySession(hSession);
        NvAPI_Unload();
        return env.Undefined();
    }

    NvDRSProfileHandle hProfile;
    status = isGlobal ? NvAPI_DRS_GetBaseProfile(hSession, &hProfile) : NVAPI_NOT_SUPPORTED;
    if (status != NVAPI_OK) {
        Napi::Error::New(env, "Failed to get DRS profile").ThrowAsJavaScriptException();
        NvAPI_DRS_DestroySession(hSession);
        NvAPI_Unload();
        return env.Undefined();
    }

    NVDRS_SETTING setting = {0};
    setting.version = NV_DRS_SETTING_VER;
    setting.settingId = settingId;
    setting.settingType = static_cast<NVDRS_SETTING_TYPE>(NVDRS_SETTING_TYPE_DWORD); // Use the defined value
    setting.u32CurrentValue = value;

    status = NvAPI_DRS_SetSetting(hSession, hProfile, &setting);
    if (status == NVAPI_OK) {
        NvAPI_DRS_SaveSettings(hSession);
    } else {
        Napi::Error::New(env, "Failed to set DRS setting").ThrowAsJavaScriptException();
    }

    NvAPI_DRS_DestroySession(hSession);
    NvAPI_Unload();
    return Napi::Boolean::New(env, status == NVAPI_OK);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("setDriverSetting", Napi::Function::New(env, SetDriverSetting));
    return exports;
}

NODE_API_MODULE(nvapi_addon, Init)
