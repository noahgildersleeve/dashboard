import jsyaml from 'js-yaml';
import isEqual from 'lodash/isEqual';
import { clone } from '@/utils/object';
import { HCI, SECRET } from '@/config/types';
import { HCI as HCI_ANNOTATIONS } from '@/config/labels-annotations';

export const QGA_JSON = {
  package_update: true,
  packages:       ['qemu-guest-agent'],
  runcmd:         [
    [
      'systemctl',
      'enable',
      '--now',
      'qemu-guest-agent'
    ]
  ]
};

export const QGA_MAP = {
  default: 'qemu-guest-agent',
  suse:    'qemu-ga.service'
};

export const USB_TABLET = [{
  bus:  'usb',
  name: 'tablet',
  type: 'tablet'
}];

export const SSH_EXISTING_TYPE = {
  EXISTING_ALL:             'EXISTING_ALL',
  EXISTING_ONLY_ANNOTATION: 'EXISTING_ANNOTATION',
  EXISTING_ONLY_CLOUD:      'EXISTING_CLOUD',
};

export default {
  methods: {
    getSSHValue(id) {
      const sshs = this.$store.getters['harvester/all'](HCI.SSH) || [];

      return sshs.find( O => O.id === id)?.spec?.publicKey || undefined;
    },

    getOsType(vm) {
      return vm?.metadata?.labels?.[HCI_ANNOTATIONS.OS] || 'linux';
    },

    getMatchQGA(osType) {
      const _QGA_JSON = clone(QGA_JSON);

      if (osType === 'openSUSE') {
        _QGA_JSON.runcmd[0][3] = QGA_MAP['suse'];
      } else {
        _QGA_JSON.runcmd[0][3] = QGA_MAP['default'];
      }

      return _QGA_JSON;
    },

    getSimilarRuncmd(osType) {
      const _QGA_JSON = clone(QGA_JSON);

      if (osType === 'openSUSE') {
        _QGA_JSON.runcmd[0][3] = QGA_MAP['default'];
      } else {
        _QGA_JSON.runcmd[0][3] = QGA_MAP['suse'];
      }

      return _QGA_JSON.runcmd[0];
    },

    hasInstallAgent(userScript, osType, oldValue) {
      let dataFormat = {};
      const _QGA_JSON = this.getMatchQGA(osType);

      try {
        dataFormat = jsyaml.load(userScript) || {};
      } catch (e) {
        new Error('Function(hasInstallAgent) error');

        return oldValue;
      }

      return dataFormat?.packages?.includes('qemu-guest-agent') && !!dataFormat?.runcmd?.find( S => S.join('-') === _QGA_JSON.runcmd[0].join('-'));
    },

    isInstallUSBTablet(spec) {
      const inputs = spec?.template?.spec?.domain?.devices?.inputs;

      if (Array.isArray(inputs)) {
        return !!inputs.find((O) => {
          return isEqual(O, USB_TABLET[0]);
        });
      } else {
        return false;
      }
    },

    getSecretCloudData(spec, type) {
      const secret = this.getSecret(spec);

      const userData = secret?.decodedData?.userdata;
      const networkData = secret?.decodedData?.networkdata;

      return { userData, networkData };
    },

    getSecret(spec) {
      const cloudInitNoCloud = spec?.template?.spec?.volumes?.find( (V) => {
        return V.name === 'cloudinitdisk';
      })?.cloudInitNoCloud || {};
      const secrets = this.$store.getters['harvester/all'](SECRET) || [];

      const secretName = cloudInitNoCloud?.secretRef?.name || cloudInitNoCloud?.networkDataSecretRef?.name;

      const secret = secrets.find(s => s.metadata.name === secretName);

      return secret;
    },

    getVolumeClaimTemplates(vm) {
      let out = [];

      try {
        out = JSON.parse(vm.metadata.annotations[HCI_ANNOTATIONS.VOLUME_CLAIM_TEMPLATE]);
      } catch (e) {
        console.error(`Function: getVolumeClaimTemplates, ${ e }`); // eslint-disable-line no-console
      }

      return out;
    },

    getRootImageId(vm) {
      const volume = this.getVolumeClaimTemplates(vm);

      return volume[0]?.metadata?.annotations?.[HCI_ANNOTATIONS.IMAGE_ID] || '';
    },

    getSSHFromAnnotation(spec) {
      const ids = spec?.template?.metadata?.annotations?.[HCI_ANNOTATIONS.SSH_NAMES] || '[]';

      return JSON.parse(ids);
    },

    convertToJson(script = '') {
      let out = {};

      try {
        out = jsyaml.load(script);
      } catch (e) {
        new Error('Function(convertToJson) error');
      }

      return out;
    },

    getSSHFromUserData(userData) {
      return this.convertToJson(userData)?.ssh_authorized_keys || [];
    },

    compareSSHValue(a = '', b = '') {
      const r = /(\r\n\t|\n|\r\t)|(\s*)/gm;

      return a.replace(r, '') === b.replace(r, '');
    },

    mergeAllSSHs(spec) {
      const keys = this.getSSHFromAnnotation(spec);
      const { userScript: userData } = this.getSecretCloudData(spec);

      if (!keys?.length < 0 && !userData) {
        return [];
      }

      let out = [];

      const allSSHs = this.$store.getters['harvester/all'](HCI.SSH) || [];

      out = (keys || []).map((id) => {
        const hasSSHResource = allSSHs.find(ssh => ssh.id === id);

        if (hasSSHResource) {
          return {
            id:    hasSSHResource.id,
            data:  hasSSHResource,
            type:  SSH_EXISTING_TYPE.EXISTING_ALL
          };
        } else {
          return {
            id,
            data:  id,
            type:  SSH_EXISTING_TYPE.EXISTING_ONLY_ANNOTATION
          };
        }
      });

      const _userDataSSH = this.getSSHFromUserData(userData);

      _userDataSSH.map( (sshValue) => {
        const hasSSHResource = allSSHs.find(ssh => this.compareSSHValue(sshValue, ssh.spec?.publicKey));

        if (hasSSHResource && !out.find(O => O.id === hasSSHResource.id)) {
          out.push({
            id:   hasSSHResource.id,
            data: hasSSHResource,
            type: SSH_EXISTING_TYPE.EXISTING_ALL
          });
        } else if (!hasSSHResource) {
          out.push({
            id:   'Unknown',
            data: sshValue,
            type: SSH_EXISTING_TYPE.EXISTING_ONLY_CLOUD
          });
        }
      });

      return out;
    },
  },
};
